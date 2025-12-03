import * as vscode from 'vscode';
import querystring from 'node:querystring';
import { uuid } from 'uuidv4';
import * as fs from 'fs';
import { DocDebuggerStatus, DualViewDoc, DocumentManager } from './dual-view-doc';
import { MemViewExtension, MemviewUriOptions } from '../../extension';
import {
    IWebviewDocXfer, ICmdGetMemory, IMemoryInterfaceCommands, ICmdBase, CmdType,
    IMessage, ICmdSetMemory, ICmdSetByte, ICmdSetExpr, IMemviewDocumentOptions, ITrackedDebugSessionXfer,
    ICmdClientState, ICmdGetStartAddress, ICmdButtonClick, ICmdSettingsChanged, ICmdAddMemoryView,
    UnknownDocId, ICmdGetMaxBytes, IFavoriteInfo, ICmdOpenFavorite
} from './shared';
import { DebuggerTrackerLocal, ITrackedDebugSession } from './debug-tracker';
import { DebugProtocol } from '@vscode/debugprotocol';
import { DebugSessionStatus } from 'debug-tracker-vscode';
import { hexFmt64 } from './utils';
import { FavoritesManager } from './favorites-manager';

const KNOWN_SCHMES = {
    FILE: 'file',                                            // Only for testing
    VSCODE_DEBUG_MEMORY_SCHEME: 'vscode-debug-memory',       // Used by VSCode core
    CORTEX_DEBUG_MEMORY_SCHEME: 'cortex-debug-memory'        // Used by cortex-debug
};
const KNOWN_SCHEMES_ARRAY = Object.values(KNOWN_SCHMES);

export class MemviewDocument implements vscode.CustomDocument {
    private disposables: vscode.Disposable[] | undefined = [];
    private sessionId: string | undefined;
    private options: IMemviewDocumentOptions = {
        uriString: '',
        isReadonly: true,
        memoryReference: '0x0',
        isFixedSize: false,
        initialSize: 1024,
        bytes: new Uint8Array(0),
        fsPath: ''
    };
    constructor(public uri: vscode.Uri) {
    }

    public getOptions(): IMemviewDocumentOptions {
        return Object.assign({}, this.options);
    }

    async decodeOptionsFromUri(_options?: IMemviewDocumentOptions) {
        Object.assign(this.options, _options);
        this.options.uriString = this.uri.toString();
        this.options.fsPath = this.uri.fsPath;
        if (this.uri.scheme === KNOWN_SCHMES.VSCODE_DEBUG_MEMORY_SCHEME) {
            const p = this.uri.path.split('/');
            if (p.length) {
                this.options.memoryReference = decodeURIComponent(p[0]);
                try {
                    const stat = await vscode.workspace.fs.stat(this.uri);
                    if (stat.permissions === vscode.FilePermission.Readonly) {
                        this.options.isReadonly = true;
                    }
                }
                catch (e) { }
                // vscode's uri.query contains a range but it isn't used so I don't know how to interpret it. See following
                // code from vscode. We don't use displayName either because it is always 'memory'
                /*
                return URI.from({
                    scheme: DEBUG_MEMORY_SCHEME,
                    authority: sessionId,
                    path: '/' + encodeURIComponent(memoryReference) + `/${encodeURIComponent(displayName)}.bin`,
                    query: range ? `?range=${range.fromOffset}:${range.toOffset}` : undefined,
                });
                */
            }
            this.sessionId = this.uri.authority;
        } else if (this.uri.scheme === KNOWN_SCHMES.CORTEX_DEBUG_MEMORY_SCHEME) {
            const opts = querystring.parse(this.uri.query);
            Object.assign(this.options, opts);
            this.sessionId = this.uri.authority;
        } else {
            this.sessionId = undefined;
            const contents = fs.readFileSync(this.uri.fsPath);
            this.options.bytes = new Uint8Array(contents);
            this.options.initialSize = this.options.bytes.length;
            this.options.isFixedSize = true;
        }
    }

    private provider: MemviewDocumentProvider | undefined;
    private panel: vscode.WebviewPanel | undefined;
    public setEditorHandles(p: MemviewDocumentProvider, webviewPanel: vscode.WebviewPanel) {
        this.provider = p;
        this.panel = webviewPanel;
        this.panel.webview.onDidReceiveMessage(e => this.handleMessage(e), null, this.disposables);
    }

    public handleMessage(e: any) {
        console.log(e);
    }

    dispose(): void {
        // throw new Error("Method not implemented.");
    }
}

export class MemviewDocumentProvider implements vscode.CustomEditorProvider {
    private static readonly viewType = 'memory-view.memoryView';
    public static register(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.window.registerCustomEditorProvider(
                MemviewDocumentProvider.viewType,
                new MemviewDocumentProvider(context),
                {
                    supportsMultipleEditorsPerDocument: false
                }
            )
        );
    }
    constructor(public context: vscode.ExtensionContext) {
    }

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<MemviewDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
    saveCustomDocument(_document: vscode.CustomDocument, _cancellation: vscode.CancellationToken): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    saveCustomDocumentAs(_document: vscode.CustomDocument, _destination: vscode.Uri, _cancellation: vscode.CancellationToken): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    revertCustomDocument(_document: vscode.CustomDocument, _cancellation: vscode.CancellationToken): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    backupCustomDocument(_document: vscode.CustomDocument, _context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
        throw new Error('Method not implemented.');
    }

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        if (!KNOWN_SCHEMES_ARRAY.includes(uri.scheme.toLocaleLowerCase())) {
            throw new Error(`Unsupported Uri scheme ${uri.scheme}. Allowed schemes are ${KNOWN_SCHEMES_ARRAY.join(', ')}`);
        }
        const document = new MemviewDocument(uri);
        await document.decodeOptionsFromUri();
        return document;
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Add the webview to our internal set of active webviews
        // this.webviews.add(document.uri, webviewPanel);
        const memDoc = document as MemviewDocument;
        if (!memDoc) {
            throw new Error('Invalid document type to open');
        }

        webviewPanel.webview.options = {
            enableScripts: true,
        };

        webviewPanel.webview.html = MemviewDocumentProvider.getWebviewContent(
            webviewPanel.webview, this.context, JSON.stringify(memDoc.getOptions()));
        memDoc.setEditorHandles(this, webviewPanel);
    }

    public static getWebviewContent(webview: vscode.Webview, context: vscode.ExtensionContext, initJson: string, viewType: string = ''): string {
        // Convert the styles and scripts for the webview into webview URIs
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'memview.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'memview.css')
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );

        const nonce = getNonce();
        const ret = /* html */ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">

            <!--
            Use a content security policy to only allow loading images from https or from our extension directory,
            and only allow scripts that have a specific nonce.
            -->
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}
    blob:; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet" />
            <link href="${codiconsUri}" rel="stylesheet" />
            <title>Hex Editor</title>
            <script nonce="${nonce}" type="text/javascript">
                window.initialDataFromVSCode = '${initJson}';
                window.viewType = '${viewType}';
            </script>
          </head>
          <body>
          <div id="root"></div>
          <script nonce="${nonce}" src="${scriptUri}" defer></script>
          </body>
        </html>`;
        return ret;
    }
}

export interface IFindByUriReturn {
    doc: DualViewDoc | undefined,
    props: IWebviewDocXfer,
    session: vscode.DebugSession | undefined,
    sessionInfo: ITrackedDebugSession,
    expr: string | undefined
}

export class MemViewPanelProvider implements vscode.WebviewViewProvider, vscode.UriHandler {
    private static context: vscode.ExtensionContext;
    private static readonly stateVersion = 1;
    public static Providers: MemViewPanelProvider[] = [];
    private webviewView: vscode.WebviewView | undefined;
    public static favoritesManager: FavoritesManager;
    public manager: DocumentManager;
    public isEnabled: boolean = false;

    public static register(context: vscode.ExtensionContext) {
        MemViewPanelProvider.context = context;
        MemViewPanelProvider.favoritesManager = new FavoritesManager(context);
        MemViewPanelProvider.favoritesManager.init();

        const viewTypes = [
            'memory-view.memoryView',
            'memory-view.memoryView1',
            'memory-view.memoryView2',
            'memory-view.memoryView3',
            'memory-view.memoryView4',
            'memory-view.memoryView5'
        ];

        for (const viewType of viewTypes) {
            const provider = new MemViewPanelProvider(context, viewType);
            MemViewPanelProvider.Providers.push(provider);
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(
                    viewType, provider, {
                    webviewOptions: {
                        retainContextWhenHidden: true
                    }
                })
            );
            if (viewType === 'memory-view.memoryView') {
                context.subscriptions.push(vscode.window.registerUriHandler(provider));
            }
        }
    }

    constructor(public context: vscode.ExtensionContext, public viewType: string) {
        this.manager = new DocumentManager();
        this.manager.init(new DebuggerIF());
        MemViewPanelProvider.context = context;
        DebuggerTrackerLocal.eventEmitter.on('any', this.debuggerStatusChanged.bind(this));
        
        if (viewType === 'memory-view.memoryView') {
            this.isEnabled = true;
        }

        try {
            const ver = context.workspaceState.get('version');
            if (ver === MemViewPanelProvider.stateVersion) {
                const obj = context.workspaceState.get(this.stateKeyName);
                const saved = obj as IWebviewDocXfer[];
                if (saved) {
                    this.manager.restoreSerializableAll(saved);
                }
            }
        }
        catch (e) {
            this.manager.restoreSerializableAll([]);
        }
    }

    private get stateKeyName(): string {
        return `documents-${this.viewType}`;
    }

    public findByUri(uri: vscode.Uri): IFindByUriReturn {
        const options = querystring.parse(uri.query);
        const cvt = (value: string | string[] | undefined): string | undefined => {
            return value === undefined ? undefined : (Array.isArray(value) ? value.join(',') : value);
        };
        const trimSlashes = (path: string): string => {
            while (path.startsWith('/')) {
                path = path.substring(1);
            }
            while (path.endsWith('/')) {
                path = path.substring(0, path.length - 1);
            }
            return path;
        };
        const path = trimSlashes(decodeURIComponent(uri.path ?? ''));
        const expr = cvt(options.expr) || cvt(options.memoryReference);
        if (!expr && !path) {
            throw new Error('MemView URI handler: No expression or path provided');
        }

        let session = vscode.debug.activeDebugSession;
        const optSessionId = cvt(options.sessionId);
        const useCurrent = (!optSessionId || optSessionId === 'current');
        const sessionId = useCurrent && session ? session.id : optSessionId || session?.id || uuid();
        const sessionInfo = DebuggerTrackerLocal.getSessionById(sessionId);
        if (sessionInfo) {
            session = sessionInfo.session;
        }

        // Someone can sneak-ing debugger we don't support, but then it will never work as we will never
        // attach to such a debugger. But it will get into our document list
        const props: IWebviewDocXfer = {
            docId: uuid(),
            sessionId: sessionId,
            sessionName: session?.name || cvt(options.sessionName) || '',
            displayName: cvt(options.displayName) || path || expr || '0',
            expr: expr || path,
            size: '4 * 1024 * 1024',
            wsFolder: session?.workspaceFolder?.uri.toString() || cvt(options.wsFolder) || '',
            startAddress: '',
            endian: 'little',
            format: '4-byte',
            column: '4',
            maxBytes: '',
            isReadOnly: !sessionInfo?.canWriteMemory,
            clientState: {},
            baseAddressStale: true,
            maxBytesStale: true,
            isCurrentDoc: true,
        };

        const existing = this.manager.findDocumentIfExists(props);
        if (existing) {
            this.showPanel();
            if (existing !== this.manager.currentDoc) {
                this.manager.setCurrentDoc(existing.docId);
                this.updateHtmlForInit();
            }
        }
        return {
            doc: existing,
            props: props,
            session: session,
            sessionInfo: sessionInfo,
            expr: expr
        };
    }

    public handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
        try {
            const existing = this.findByUri(uri);
            if (existing.doc) {
                return Promise.resolve();
            }
            const props = existing.props;
            const expr = existing.expr;
            if (existing.sessionInfo && existing.sessionInfo.status === DebugSessionStatus.Stopped) {
                MemViewPanelProvider.getExprResult(existing.sessionInfo.session, props.expr).then((addr) => {
                    props.baseAddressStale = false;
                    props.startAddress = addr;
                    props.maxBytesStale = false;
                    props.maxBytes = String(4 * 1024 * 1024);
                    const doc = new DualViewDoc(props, this.manager);
                    doc.sessionStatus = DocDebuggerStatus.Stopped;
                    doc.isReady = true;
                    this.showPanel();
                    return Promise.resolve();
                }).catch((e) => {
                    vscode.window.showErrorMessage(`Error: Bad expression in Uri '${expr}'. ${e}`);
                    return Promise.reject(new Error(`MemView URI handler: Expression ${expr} failed to evaluate: ${e}`));
                });
            } else {
                let msg = `MemView URI handler: New view for ${props.expr} added. It will have contents updated when program is paused or started.`;
                if (this.manager.currentDoc) {       // There is already one!
                    props.isCurrentDoc = false;
                    msg += ' You will have to change the current view manually since there is already a view displayed';
                }
                vscode.window.showInformationMessage(msg);
                const doc = new DualViewDoc(props, this.manager);
                if (existing.sessionInfo && (existing.sessionInfo.status === DebugSessionStatus.Running || existing.sessionInfo.status === DebugSessionStatus.Started)) {
                    doc.sessionStatus = DocDebuggerStatus.Busy;
                }
                this.showPanel();
                return Promise.resolve();
            }
        }
        catch (e) {
            return Promise.reject(e);
        }
    }

    public saveState() {
        const state = this.context.workspaceState;
        const obj = this.manager.storeSerializableAll(true);
        state.update('version', MemViewPanelProvider.stateVersion);
        state.update(this.stateKeyName, obj);
        // console.log('Finished saving state');
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext<unknown>,
        _token: vscode.CancellationToken): void | Thenable<void> {

        webviewView.webview.options = {
            enableScripts: true,
        };
        webviewView.description = 'View Memory from Debuggers';
        this.webviewView = webviewView;

        // console.log('In resolveWebviewView');
        this.webviewView.onDidDispose((_e) => {
            // This is never called when extension exits
            // console.log('disposed webView');
            this.webviewView = undefined;
            this.saveState();
        });

        this.webviewView.onDidChangeVisibility(() => {
            // console.log('Visibility = ', this.webviewView?.visible);
        });
        webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

        this.updateHtmlForInit();
    }

    public dumpAllToClipboard(doc: DualViewDoc): Promise<void> {
        return new Promise<void>((resolve) => {
            const lines: string[] = [];
            this.dumpAll(doc, (line) => {
                lines.push(line);
            }).then(() => {
                vscode.env.clipboard.writeText(lines.join('\n'));
            }).catch((e) => {
                console.error('MemView: dumpAll Failed?!?!', e);
            }).finally(() => {
                resolve();
            });
        });
    }

    public dumpAllToFile(doc: DualViewDoc): Promise<void> {
        return new Promise<void>((resolve) => {
            const opts: vscode.SaveDialogOptions = {
                filters: {
                    'Text or Binary files': ['*.txt', '*.dat', '*.bin'],
                },
                saveLabel: 'Save',
                title: 'Select text file for writing'
            };
            vscode.window.showSaveDialog(opts).then((uri) => {
                if (uri) {
                    const ext = uri.fsPath.toLowerCase().split('.').pop();
                    const isBinary = ext === 'bin';
                    const stream = fs.createWriteStream(uri.fsPath);
                    stream.on('error', (e) => {
                        vscode.window.showErrorMessage(`Could not open file name "${uri}" for writing: ${e}`);
                        resolve();
                    });
                    stream.on('ready', () => {
                        if (isBinary) {
                            // Dump raw binary
                            this.dumpBin(doc, (chunk) => {
                                stream.write(chunk);
                            }).then(() => {
                                stream.end();
                            }).catch((e) => {
                                console.error('MemView: dumpBin Failed?!?!', e);
                            }).finally(() => {
                                resolve();
                            });
                        } else {
                            // Dump formatted text
                            this.dumpAll(doc, (line) => {
                                stream.write(line + '\n');
                            }).then(() => {
                                stream.end();
                            }).catch((e) => {
                                console.error('MemView: dumpAll Failed?!?!', e);
                            }).finally(() => {
                                resolve();
                            });
                        }
                    });
                } else {
                    resolve();
                }
            });
        });
    }

    public async dumpBin(doc: DualViewDoc, cb: (chunk: Buffer) => void) {
        if (doc.sessionStatus === DocDebuggerStatus.Stopped) {
            try {
                // Don't care if we cannot refresh. Dump what we got
                await doc.refreshMemoryIfStale();
            }
            finally { }
        }
        const memory = doc.getMemoryRaw();
        let base = memory.baseAddress;
        for (let pageIx = 0; pageIx < memory.numPages(); pageIx++, base += BigInt(doc.PageSize || 512)) {
            const page = memory.getPage(base);
            if (page && page.length) {
                cb(Buffer.from(page));
            }
        }
    }

    public async dumpAll(doc: DualViewDoc, cb: (line: string) => void) {
        if (doc.sessionStatus === DocDebuggerStatus.Stopped) {
            try {
                // Don't care if we cannot refresh. Dump what we got
                await doc.refreshMemoryIfStale();
            }
            finally { }
        }
        const memory = doc.getMemoryRaw();
        const bytePerWord = doc.getBytesPerCell(doc.format);
        const getByteOrder = (isBigEndian: boolean, bytePerWord: number): number[] => {
            return isBigEndian
                ? Array.from({ length: bytePerWord }, (_, index) => index)
                : Array.from({ length: bytePerWord }, (_, index) => bytePerWord - index - 1);
        };
        const byteOrder = getByteOrder(doc.endian === 'big', bytePerWord);
        let base = memory.baseAddress;
        for (let pageIx = 0; pageIx < memory.numPages(); pageIx++, base += BigInt(doc.PageSize || 512)) {
            const page = memory.getPage(base);
            if (page && page.length) {
                const columnLength = Number(doc.column) + 1;
                let addr = base;
                let line: string[] = [hexFmt64(addr, false)];
                let ix = 0;
                while (ix < page.length) {
                    let val = 0n;
                    for (let iy = 0; iy < bytePerWord; iy++) {
                        const byteIndex = byteOrder[iy];
                        val = (val << 8n) | BigInt(page[ix + byteIndex] & 0xff);
                    }
                    line.push(val.toString(16).padStart(bytePerWord * 2, '0'));
                    if (line.length === columnLength) {
                        cb && cb(line.join(' '));
                        addr += BigInt(doc.bytesPerRow);
                        line = [hexFmt64(addr, false)];
                    }
                    ix += bytePerWord;
                }
                (line.length > 1) && cb && cb(line.join(' '));
            }
        }
    }

    private getContextKey(): string {
        if (this.viewType === 'memory-view.memoryView') {
            return 'memory-view:showMemoryPanel';
        }
        const match = this.viewType.match(/memory-view\.memoryView(\d+)/);
        if (match) {
            return `memory-view:showPanel${match[1]}`;
        }
        return '';
    }

    private handleMessage(msg: any) {
        // console.log('MemViewPanelProvider.onDidReceiveMessage', msg);
        switch (msg?.type) {
            case 'command': {
                const body: ICmdBase = msg.body as ICmdBase;
                if (!body) { break; }
                switch (body.type) {
                    case CmdType.GetDebuggerSessions: {
                        this.sendAllDebuggerSessions(body);
                        break;
                    }
                    case CmdType.GetStartAddress: {
                        const doc = this.manager.getDocumentById(body.docId);
                        const memCmd = (body as ICmdGetStartAddress);
                        if (doc) {
                            const oldAddr = doc.startAddress;
                            doc.getStartAddress().then((v) => {
                                if (oldAddr !== v) {
                                    // Do it the lazy way for now.
                                    this.updateHtmlForInit();
                                } else {
                                    this.postResponse(body, v.toString());
                                }
                            });
                        } else {
                            this.postResponse(body, memCmd.def);
                        }
                        break;
                    }
                    case CmdType.GetMaxBytes: {
                        const doc = this.manager.getDocumentById(body.docId);
                        const memCmd = (body as ICmdGetMaxBytes);
                        if (doc) {
                            const oldSize = doc.maxBytes;
                            doc.getMaxBytes().then((v) => {
                                if (oldSize !== v) {
                                    // Do it the lazy way for now.
                                    this.updateHtmlForInit();
                                } else {
                                    this.postResponse(body, v.toString());
                                }
                            });
                        } else {
                            this.postResponse(body, memCmd.def);
                        }
                        break;
                    }
                    case CmdType.GetMemory: {
                        const doc = this.manager.getDocumentById(body.docId);
                        if (doc) {
                            const memCmd = (body as ICmdGetMemory);
                            doc.getMemoryPage(BigInt(memCmd.addr), memCmd.count).then((b) => {
                                this.postResponse(body, b);
                            });
                        } else {
                            this.postResponse(body, new Uint8Array(0));
                        }
                        break;
                    }
                    case CmdType.GetDocuments: {
                        const docs = this.manager.storeSerializableAll();
                        this.postResponse(body, docs);
                        break;
                    }
                    case CmdType.SetExpr: {
                        const doc = this.manager.getDocumentById(body.docId);
                        if (doc) {
                            const memCmd = (body as ICmdSetExpr);
                            doc.setExprPage(memCmd.expr, memCmd.val, memCmd.count).then((value) => {
                                this.manager.markAllDocsStale();
                                this.updateHtmlForInit();
                            });
                        }
                        break;
                    }
                    case CmdType.SetByte: {
                        const doc = this.manager.getDocumentById(body.docId);
                        if (doc) {
                            const memCmd = (body as ICmdSetByte);
                            doc.setByteLocal(BigInt(memCmd.addr), memCmd.value);
                        }
                        break;
                    }
                    case CmdType.SaveClientState: {
                        const doc = this.manager.getDocumentById(body.docId);
                        if (doc) {
                            doc.setClientStateAll((body as ICmdClientState).state);
                        }
                        break;
                    }
                    case CmdType.ButtonClick: {
                        const doc = body.docId && body.docId !== UnknownDocId ? this.manager.getDocumentById(body.docId) : undefined;
                        const button = (body as ICmdButtonClick).button;
                        switch (button) {
                            case 'close': {
                                this.manager.removeDocument(body.docId);
                                this.updateHtmlForInit();
                                break;
                            }
                            case 'select': {
                                this.manager.setCurrentDoc(body.docId);
                                this.updateHtmlForInit();
                                break;
                            }
                            case 'refresh': {
                                this.manager.markAllDocsStale();
                                this.updateHtmlForInit();
                                break;
                            }
                            case 'copy-all-to-clipboard': {
                                doc && this.dumpAllToClipboard(doc);
                                break;
                            }
                            case 'load-all': {
                                if (doc) {
                                    if (doc.size === '4 * 1024 * 1024') {
                                        vscode.window.showInformationMessage('Load all is disabled for default size (4 * 1024 * 1024). Please change the size in settings.');
                                    } else {
                                        doc.ensureAllPagesLoaded().then(() => {
                                            const msg: ICmdBase = {
                                                type: CmdType.ScrollToBottom,
                                                sessionId: doc.sessionId,
                                                docId: doc.docId
                                            };
                                            this.postNotice(msg, {});
                                        });
                                    }
                                }
                                break;
                            }
                            case 'copy-all-to-file': {
                                doc && this.dumpAllToFile(doc);
                                break;
                            }
                            case 'open-new-panel': {
                                const provider = MemViewPanelProvider.Providers.find(p => !p.isEnabled);
                                if (provider) {
                                    provider.isEnabled = true;
                                    const contextKey = provider.getContextKey();
                                    if (contextKey) {
                                        vscode.commands.executeCommand('setContext', contextKey, true);
                                        if (provider.webviewView) {
                                            provider.webviewView.show(true);
                                        } else {
                                            vscode.commands.executeCommand(`${provider.viewType}.focus`);
                                        }
                                    }
                                } else {
                                    vscode.window.showInformationMessage('Max number of memory panels reached.');
                                }
                                break;
                            }
                            case 'close-panel': {
                                this.isEnabled = false;
                                const contextKey = this.getContextKey();
                                if (contextKey) {
                                    vscode.commands.executeCommand('setContext', contextKey, false);
                                }
                                break;
                            }
                        }
                        break;
                    }
                    case CmdType.SettingsChanged: {
                        const doc = this.manager.getDocumentById(body.docId);
                        const newSettings = (body as ICmdSettingsChanged)?.settings;
                        if (doc && newSettings) {
                            if ((doc.expr !== newSettings.expr) && (doc.sessionStatus !== DocDebuggerStatus.Stopped)) {
                                vscode.window.showInformationMessage(`Memory view address expression changed to ${newSettings.expr}. ` +
                                    'The view contents will be updated the next time the debugger is paused');
                            }
                            if ((doc.size !== newSettings.size) && (doc.sessionStatus !== DocDebuggerStatus.Stopped)) {
                                vscode.window.showInformationMessage(`Memory view size expression changed to ${newSettings.size}. ` +
                                    'The view contents will be updated the next time the debugger is paused');
                            }
                            doc.updateSettings((body as ICmdSettingsChanged).settings);
                            this.updateHtmlForInit();
                        }
                        break;
                    }
                    case CmdType.AddNewMemoryView: {
                        const info = (body as ICmdAddMemoryView).info;
                        if (vscode.debug.activeDebugSession) {
                            this.addMemoryView(vscode.debug.activeDebugSession, info.expr, info.size);
                        } else {
                            vscode.window.showErrorMessage('There is no active debug session');
                        }
                        break;
                    }
                    case CmdType.GetFavoriteInfo: {
                        const memCmd = (body as ICmdOpenFavorite);
                        const favorites = MemViewPanelProvider.favoritesManager.getFavorites(memCmd.name);
                        this.postResponse(body, favorites);
                        break;
                    }
                    case CmdType.OpenFavorite: {
                        const memCmd = (body as ICmdOpenFavorite);
                        const info = MemViewPanelProvider.favoritesManager.getFavorite(memCmd.name);
                        if (info && vscode.debug.activeDebugSession) {
                            this.addMemoryView(vscode.debug.activeDebugSession, info.expr, info.size, memCmd.name);
                        } else {
                            vscode.window.showWarningMessage(`Failed to open favorite '${memCmd.name}'`);
                        }
                        break;
                    }
                    case CmdType.AddFavorite: {
                        const info = (body as any).info;
                        if (info) {
                             vscode.window.showInputBox({
                                prompt: 'Enter name for favorite',
                                value: info.name || ''
                             }).then(name => {
                                 if (name) {
                                     MemViewPanelProvider.favoritesManager.addFavorite(name, { expr: info.expr, size: info.size });
                                 }
                             });
                        } else {
                            const nameExprOptions: vscode.InputBoxOptions = { title: 'Favorite memory name', prompt: 'Enter a name' };
                            const addrExprOptions: vscode.InputBoxOptions = { title: 'Favorite memory address', prompt: 'Enter address', placeHolder: '0x' };
                            const sizeExprOptions: vscode.InputBoxOptions = { title: 'Favorite memory size', prompt: 'Enter size', placeHolder: '4 * 1024 * 1024' };
                            
                            vscode.window.showInputBox(nameExprOptions).then((name) => {
                                if (!name) return;
                                vscode.window.showInputBox(addrExprOptions).then((expr) => {
                                    if (!expr) return;
                                    vscode.window.showInputBox(sizeExprOptions).then((size) => {
                                        if (!size) return;
                                        MemViewPanelProvider.favoritesManager.addFavorite(name, { expr, size });
                                    });
                                });
                            });
                        }
                        break;
                    }
                    case CmdType.DeleteFavorite: {
                        const memCmd = (body as ICmdOpenFavorite);
                        MemViewPanelProvider.favoritesManager.deleteFavorite(memCmd.name);
                        this.postResponse(body, true);
                        break;
                    }
                    case CmdType.ImportFavorites: {
                        MemViewPanelProvider.favoritesManager.importFavorites().then(() => {
                            this.postResponse(body, true);
                        });
                        break;
                    }
                    case CmdType.ExportFavorites: {
                        MemViewPanelProvider.favoritesManager.exportFavorites().then(() => {
                            this.postResponse(body, true);
                        });
                        break;
                    }
                    default: {
                        console.error('handleMessage: Unknown command', body);
                        break;
                    }
                }
                break;
            }
            case 'refresh': {
                break;
            }
        }
    }

    private postResponse(msg: ICmdBase, body: any) {
        const obj: IMessage = {
            type: 'response',
            seq: msg.seq ?? 0,
            command: msg.type,
            body: body
        };
        this.webviewView?.webview.postMessage(obj);
    }

    private postNotice(msg: ICmdBase, body: any) {
        const obj: IMessage = {
            type: 'notice',
            seq: msg.seq ?? 0,
            command: msg.type,
            body: body
        };
        this.webviewView?.webview.postMessage(obj);
    }

    private debuggerStatusChanged(arg: ITrackedDebugSessionXfer) {
        this.manager.debuggerStatusChanged(arg.sessionId, arg.status, arg.sessionName, arg.wsFolder);
        if (this.webviewView) {
            const msg: ICmdBase = {
                type: CmdType.DebugerStatus,
                sessionId: arg.sessionId,
                docId: ''
            };
            this.postNotice(msg, arg);
            if (arg.status === DebugSessionStatus.Terminated) {
                this.saveState();
            }
        }
    }

    private sendAllDebuggerSessions(msg: ICmdBase) {
        if (this.webviewView?.visible) {
            const allSessions = DebuggerTrackerLocal.getCurrentSessionsSerializable();
            this.postResponse(msg, allSessions);
        }
    }

    private updateHtmlForInit() {
        if (this.webviewView) {
            this.webviewView.webview.html = MemviewDocumentProvider.getWebviewContent(
                this.webviewView.webview, this.context, '', this.viewType);
        }
        this.saveState();
    }

    private async showPanel(refresh = true) {
        if (!this.webviewView || !this.webviewView.visible) {
            // Following will automatically refresh
            try {
                await MemViewExtension.enableMemoryView();
            }
            catch {
                console.error('Why did  MemViewExtension.enableMemoryView() fail');
            }
            vscode.commands.executeCommand(this.viewType + '.focus');
        } else if (refresh) {
            this.updateHtmlForInit();
        }
    }

    public addMemoryView(session: vscode.DebugSession, addrExpr: string, sizeExpr: string, displayName?: string) {
        sizeExpr = sizeExpr.trim();
        addrExpr = addrExpr.trim();
        let size: string;

        MemViewPanelProvider.getExprResult(session, sizeExpr).then((result) => {
            size = result;
            return MemViewPanelProvider.getExprResult(session, addrExpr);
        }).then((addr) => {
            const sessonInfo = DebuggerTrackerLocal.getSessionById(session.id);
            const props: IWebviewDocXfer = {
                docId: uuid(),
                sessionId: session.id,
                sessionName: session.name,
                displayName: displayName || addrExpr,
                expr: addrExpr,
                endian: 'little',
                format: '4-byte',
                column: '4',
                size: sizeExpr,
                wsFolder: session.workspaceFolder?.uri.toString() || '.',
                startAddress: addr,
                maxBytes: size,
                isReadOnly: !sessonInfo.canWriteMemory,
                clientState: {},
                baseAddressStale: false,
                maxBytesStale: false,
                isCurrentDoc: true,
            };
            const existing = this.manager.findDocumentIfExists(props);
            if (existing) {
                if (existing !== this.manager.currentDoc) {
                    this.manager.setCurrentDoc(existing.docId);
                    this.updateHtmlForInit();
                    this.showPanel();
                }
            } else {
                const doc = new DualViewDoc(props, this.manager);
                if (sessonInfo) {
                    if (sessonInfo.status === DebugSessionStatus.Stopped) {
                        doc.sessionStatus = DocDebuggerStatus.Stopped;
                        doc.isReady = true;
                    } else if (sessonInfo.status === DebugSessionStatus.Running || sessonInfo.status === DebugSessionStatus.Started) {
                        doc.sessionStatus = DocDebuggerStatus.Busy;
                    }
                }
                this.showPanel();
            }
        }).catch((e) => {
            vscode.window.showErrorMessage(`Error: Bad expression. ${e}`);
        });
    }

    public static newMemoryView(expr?: string, size?: string, opts?: MemviewUriOptions | any) {
        if (typeof expr !== 'string' || !expr) {
            expr = undefined;
        }

        if (typeof size !== 'string' || !size) {
            size = undefined;
        }

        if (!expr) {
            if (opts && (typeof opts.expr === 'string')) {
                expr = opts.expr;
            } else if (opts && (typeof opts.memoryReference === 'string')) {
                expr = opts.memoryReference;
            }
        }

        if (expr && !size) {
            opts = opts || {};
            opts.expr = expr;
            if (!opts.sessionId && vscode.debug.activeDebugSession) {
                opts.sessionId = vscode.debug.activeDebugSession.id;
            }
            const uri = vscode.Uri.from({
                scheme: vscode.env.uriScheme,
                authority: 'mcu-debug.memory-view',
                path: '/' + encodeURIComponent(expr),
                query: querystring.stringify(opts as any)
            });
            if (MemViewPanelProvider.Providers.length > 0) {
                MemViewPanelProvider.Providers[0].handleUri(uri)?.then(undefined, (e: any) => {
                    vscode.window.showErrorMessage(`newMemoryView failed: ${e}`);
                });
            }
            return;
        } else if (expr && size) {
            if (vscode.debug.activeDebugSession) {
                if (MemViewPanelProvider.Providers.length > 0) {
                    MemViewPanelProvider.Providers[0].addMemoryView(vscode.debug.activeDebugSession, expr, size);
                }
            } else {
                vscode.window.showErrorMessage('There is no active debug session');
            }
            return;
        }

        const session = vscode.debug.activeDebugSession;
        if (!session) {
            vscode.window.showErrorMessage('There is no active debug session');
            return;
        }
        const ret = DebuggerTrackerLocal.isValidSessionForMemory(session.id);
        if (ret !== true) {
            vscode.window.showErrorMessage(`${ret}. Cannot add a memory view`);
            return;
        }
        const addrExprOptions: vscode.InputBoxOptions = {
            title: 'Create new memory view',
            prompt: 'Enter a hex/decimal constant of a C-expression for address',
            placeHolder: '0x',
        };
        const sizeExprOptions: vscode.InputBoxOptions = {
            title: 'New memory view size',
            prompt: 'Enter a hex/decimal constant of a C-expression for size',
            value: '4 * 1024 * 1024',
        };
        vscode.window.showInputBox(addrExprOptions).then((addrExpr: string | undefined) => {
            vscode.window.showInputBox(sizeExprOptions).then((sizeExpr: string | undefined) => {
                addrExpr = addrExpr !== undefined ? addrExpr.trim() : '';
                sizeExpr = sizeExpr !== undefined ? sizeExpr.trim() : '';
                if (addrExpr && sizeExpr && vscode.debug.activeDebugSession) {
                    if (MemViewPanelProvider.Providers.length > 0) {
                        MemViewPanelProvider.Providers[0].addMemoryView(vscode.debug.activeDebugSession, addrExpr, sizeExpr);
                    }
                }
            });
        });
    }

    static getExprResult(session: vscode.DebugSession, expr: string): Promise<string> {
        const isHexOrDec = (expr: string): boolean => {
            return /^0x[0-9a-f]+$/i.test(expr) || /^[0-9]+$/.test(expr);
        };
        if (isHexOrDec(expr)) {
            return Promise.resolve(expr);
        }
        return new Promise<string>((resolve, reject) => {
            const tmp = DebuggerTrackerLocal.getSessionById(session.id);
            const arg: DebugProtocol.EvaluateArguments = {
                expression: expr,
                context: 'hover'
            };
            if (tmp?.lastFrameId !== undefined) {
                arg.frameId = tmp.lastFrameId;
            }
            session.customRequest('evaluate', arg).then((result) => {
                if (result.memoryReference) {
                    resolve(result.memoryReference);
                    return;
                }
                if (result.result) {
                    let res: string = result.result.trim().toLocaleLowerCase();
                    if (isHexOrDec(res)) {
                        resolve(res);
                        return;
                    }
                    /* Sometimes, gdb does not give a straight hex or decimal number. For addresses, it may suffix the value with other stuff */
                    if (res.startsWith('0x')) {
                        const ary = res.match(/^0x[0-9a-f]+/);
                        if (ary) {
                            res = ary[1];
                            resolve(res);
                            return;
                        }
                    }
                    vscode.window.showInformationMessage(`Memory View: Expression '${expr}' evaluated to ${res} which is not a constant`);
                    reject(new Error(`Expression '${expr}' failed to evaluate to a proper pointer value. Result: '${res}'`));
                } else {
                    vscode.window.showInformationMessage(`Memory View: Failed to evaluate expression '${expr}'`);
                    reject(new Error(`Expression '${expr}' failed to yield a proper result. Got ${JSON.stringify(result)}`));
                }
            }).then(undefined, e => {
                vscode.window.showInformationMessage(`Memory View: Failed to evaluate expression '${expr}'`);
                reject(new Error(`Expression '${expr}' threw an error. ${JSON.stringify(e)}`));
            });
        });
    }

    static doTest(path: string) {
        const props: IWebviewDocXfer = {
            docId: uuid(),
            sessionId: getNonce(),
            sessionName: 'blah',
            displayName: '0xdeadbeef',
            expr: '0xdeafbeef',
            size: '0xdeafbeef',
            format: '4-byte',
            endian: 'little',
            column: '4',
            wsFolder: '.',
            startAddress: '0',
            maxBytes: String(4 * 1024 * 1024),
            isReadOnly: false,
            clientState: {},
            baseAddressStale: false,
            maxBytesStale: false,
            isCurrentDoc: true,
        };
        const buf = fs.readFileSync(path);
        if (MemViewPanelProvider.Providers.length > 0) {
            const manager = MemViewPanelProvider.Providers[0].manager;
            manager.init(new mockDebugger(new Uint8Array(buf), 0n));
            new DualViewDoc(props, manager);
            MemViewPanelProvider.Providers[0].updateHtmlForInit();
        }
    }
}

class mockDebugger implements IMemoryInterfaceCommands {
    constructor(private testBuffer: Uint8Array, private baseAddress: bigint) {
    }
    getStartAddress(arg: ICmdGetStartAddress): Promise<string> {
        return Promise.resolve(arg.def);
    }
    getMaxBytes(arg: ICmdGetMaxBytes): Promise<string> {
        return Promise.resolve(arg.def);
    }
    getMemory(arg: ICmdGetMemory): Promise<Uint8Array> {
        const start = Number(BigInt(arg.addr) - this.baseAddress);
        const end = start + arg.count;
        const bytes = this.testBuffer.slice(
            start > this.testBuffer.length ? this.testBuffer.length : start,
            end > this.testBuffer.length ? this.testBuffer.length : end);
        return Promise.resolve(bytes);
    }
    setExpr(_arg: ICmdSetExpr): Promise<string> {
        return Promise.resolve('0');
    }
    setMemory(_arg: ICmdSetMemory): Promise<boolean> {
        return Promise.resolve(true);
    }
}

class DebuggerIF implements IMemoryInterfaceCommands {
    getStartAddress(arg: ICmdGetStartAddress): Promise<string> {
        const session = DebuggerTrackerLocal.getSessionById(arg.sessionId);
        if (!session || (session.status !== DebugSessionStatus.Stopped)) {
            return Promise.resolve(arg.def);
        }
        return MemViewPanelProvider.getExprResult(session.session, arg.expr);
    }
    getMaxBytes(arg: ICmdGetMaxBytes): Promise<string> {
        const session = DebuggerTrackerLocal.getSessionById(arg.sessionId);
        if (!session || (session.status !== DebugSessionStatus.Stopped)) {
            return Promise.resolve(arg.def);
        }
        return MemViewPanelProvider.getExprResult(session.session, arg.expr);
    }
    getMemory(arg: ICmdGetMemory): Promise<Uint8Array> {
        const memArg: DebugProtocol.ReadMemoryArguments = {
            memoryReference: arg.addr,
            count: arg.count
        };
        return new Promise<Uint8Array>((resolve) => {
            const session = DebuggerTrackerLocal.getSessionById(arg.sessionId);
            if (!session || (session.status !== DebugSessionStatus.Stopped)) {
                return resolve(new Uint8Array(0));
            }
            session.session.customRequest('readMemory', memArg).then((result) => {
                const buf = Buffer.from(result.data, 'base64');
                const ary = new Uint8Array(buf);
                return resolve(ary);
            }), ((e: any) => {
                debugConsoleMessage(e, arg);
                return resolve(new Uint8Array(0));
            });
        });
    }
    setExpr(_arg: ICmdSetExpr): Promise<string> {
        let type = 'unsigned char';
        if (_arg.count === 2) {
            type = 'unsigned short';
        } else if (_arg.count === 4) {
            type = 'unsigned int';
        } else if (_arg.count === 8) {
            type = 'unsigned long long';
        }

        const memArg: DebugProtocol.SetExpressionArguments = {
            expression: '*(' + type + '*)(' + _arg.expr + ')',
            value: _arg.val
        };
        return new Promise<string>((resolve) => {
            const session = DebuggerTrackerLocal.getSessionById(_arg.sessionId);
            if (!session || (session.status !== DebugSessionStatus.Stopped)) {
                return resolve('0');
            }
            if (session.lastFrameId !== undefined) {
                memArg.frameId = session.lastFrameId;
            }
            session.session.customRequest('setExpression', memArg).then((result) => {
                session.session.customRequest('sendInvalidate', { areas: ['variables'], stackFrameId: session.lastFrameId });
                return resolve(result.value);
            }), ((e: any) => {
                console.error('Error while setExpression', e);
                return resolve('0');
            });
        });
    }
    setMemory(_arg: ICmdSetMemory): Promise<boolean> {
        return Promise.resolve(true);
    }
}


function debugConsoleMessage(e: any, arg: ICmdGetMemory) {
    const con = vscode.debug.activeDebugConsole;
    if (con) {
        const msg = e instanceof Error ? e.message : e ? e.toString() : 'Unknown error';
        con.appendLine(`Memview: Failed to read memory @ ${arg.addr}. ` + msg);
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
}
