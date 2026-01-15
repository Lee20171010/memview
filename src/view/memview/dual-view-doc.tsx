/* eslint-disable no-debugger */
/*
 * This file is a shared file between the webview and the main extension. There should
 * not be any webview or VSCode specific things in here. It should be all generic
 * node/typescript
 *
 * However, because we use some vscode Webview APIs (indirectly), it can bring in
 * the vscode post functions that are only valid in the Webview
 */


import { vscodePostCommand, vscodePostCommandNoResponse, isInWebview } from './connection';
import { Buffer } from 'buffer';
import events from 'events';
import {
    IMemValue,
    IMemoryInterfaceCommands,
    IWebviewDocXfer,
    ICmdBase,
    ICmdGetMemory,
    CmdType,
    ICmdSetByte,
    ICmdSetExpr,
    IWebviewDocInfo,
    ModifiedXferMap,
    DebugSessionStatusSimple,
    ICmdClientState,
    ICmdGetStartAddress,
    ICmdGetMaxBytes,
    UnknownDocId,
    EndianType,
    RowFormatType,
    IModifiableProps,
    IAddMemoryInfo,
    IFavoriteInfo,
    ICmdOpenFavorite
} from './shared';
import { hexFmt64 } from './utils';

export enum DualViewDocGlobalEventType {
    CurrentDoc = 'current-doc',
    DebuggerStatus = 'debugger-status',
    BaseAddress = 'base-address',
    ScrollToBottom = 'scroll-to-bottom',
    ScrollToAddress = 'scroll-to-address'
}

export enum DocDebuggerStatus {
    Default = 'No debugger attached',
    Busy = 'Debugger attached, busy',
    Stopped = 'Debugger attached, stopped'
}

interface IByteVal {
    previous: number;
    current: number;
}
export interface IDualViewDocGlobalEventArg {
    type: DualViewDocGlobalEventType;
    sessionStatus?: DocDebuggerStatus;
    baseAddress: bigint;
    maxBytes: bigint;
    docId: string;
    sessionId?: string;
    scrollToAddress?: bigint;
}

export const DummyByte: IMemValue = { cur: -1, orig: -1, stale: true, inRange: false };

export class DocumentManager {
    public globalEventEmitter = new events.EventEmitter();
    public currentDoc: DualViewDoc | undefined;
    public currentDocStack: string[] = [];
    public allDocuments: { [key: string]: DualViewDoc } = {};
    public memoryIF: IMemoryInterfaceCommands | undefined;
    public favoriteInfoAry: IFavoriteInfo[] = [];

    constructor() {
        this.globalEventEmitter.setMaxListeners(1000);
    }
    
    public init(arg: IMemoryInterfaceCommands) {
        this.memoryIF = arg;
    }

    // This is only called from within VSCode and not from the WebView
    public addDocument(doc: DualViewDoc, makeCurrent = false) {
        this.allDocuments[doc.docId] = doc;
        if (makeCurrent) {
            this.setCurrentDoc(doc);
        }
    }

    // This is only called from within VSCode and not from the WebView
    public removeDocument(docOrId: DualViewDoc | string) {
        const id = (docOrId as string) || (docOrId as DualViewDoc).docId;
        const doc = this.allDocuments[id];
        if (doc === this.currentDoc) {
            const values = Object.getOwnPropertyNames(this.allDocuments);
            let pos = values.findIndex((v) => v === doc.docId);
            this.currentDoc = undefined;
            while (this.currentDocStack.length) {
                const oldId = this.currentDocStack.pop();
                if (oldId && oldId !== id && this.allDocuments[oldId]) {
                    this.setCurrentDoc(oldId);
                    break;
                }
            }
            if (!this.currentDoc) {
                values.splice(pos, 1);
                if (values.length > 0) {
                    pos = pos % values.length;
                    this.setCurrentDoc(values[pos]);
                }
            }
        }
        delete this.allDocuments[id];
    }

    public clearAllDocuments() {
        this.allDocuments = {};
        this.currentDoc = undefined;
        this.currentDocStack = [];
    }

    // This is only called from within VSCode and not from the WebView
    public setCurrentDoc(docOrId: DualViewDoc | string) {
        const oldId = this.currentDoc?.docId;
        const id: string = typeof docOrId === 'string' ? (docOrId as string) : (docOrId as DualViewDoc).docId;
        const doc = this.allDocuments[id];
        if (doc) {
            if (this.currentDoc) {
                this.currentDocStack.push(this.currentDoc.docId);
            }
            this.currentDoc = doc;
        }
        if (doc && oldId !== doc?.docId) {
            // Don't think the following is needed
            doc.emitGlobalEvent(DualViewDocGlobalEventType.CurrentDoc);
        }
    }

    /**
     *
     * @param info
     * @returns false is no existing doc matches, true if the current doc matches. Returns the doc object if
     * the current doc needs to be changed to an existing doc
     */
    public findDocumentIfExists(info: IWebviewDocXfer): undefined | DualViewDoc {
        if (DualViewDoc.InWebview()) {
            return undefined; // Not allowed in a webview
        }
        for (const doc of Object.values(this.allDocuments)) {
            if (info.expr !== doc.expr) {
                continue;
            }
            if (info.sessionName && info.sessionName !== doc.sessionName) {
                continue;
            }
            if (info.wsFolder && info.wsFolder !== doc.wsFolder) {
                continue;
            }
            return doc;
        }
        return undefined;
    }

    public getDocumentById(id: string): DualViewDoc | undefined {
        return this.allDocuments[id];
    }
    
    public getBasicDocumentsList(): IWebviewDocInfo[] {
        const ret: IWebviewDocInfo[] = [];
        for (const key of Object.getOwnPropertyNames(this.allDocuments)) {
            const doc = this.allDocuments[key];
            const tmp: IWebviewDocInfo = {
                displayName: doc.displayName,
                sessionId: doc.sessionId,
                docId: doc.docId,
                sessionStatus: doc.sessionStatus,
                baseAddress: doc.baseAddress,
                startAddress: doc.startAddress,
                maxBytes: doc.maxBytes,
                isModified: doc.isModified(),
                isCurrent: doc === this.currentDoc
            };
            ret.push(tmp);
        }
        return ret;
    }

    public debuggerStatusChanged(
        sessionId: string,
        status: DebugSessionStatusSimple,
        sessionName: string,
        wsFolder: string
    ) {
        const debug = false;
        debug && console.log(sessionId, status, sessionName, wsFolder);
        for (const [_id, doc] of Object.entries(this.allDocuments)) {
            const oldStatus = doc.sessionStatus;
            if (doc.sessionId !== sessionId) {
                // Adoption logic check
                const nameMatch = (sessionName === doc.sessionName || !doc.sessionName);
                const isInvalidSessionFolder = !wsFolder || wsFolder === '.';
                const isDocFolderInvalid = !doc.wsFolder || doc.wsFolder === '.';
                const folderMatch = isInvalidSessionFolder || isDocFolderInvalid || (doc.wsFolder === wsFolder);
                const statusMatch = (status === 'started' || status === 'stopped');
                
                if (statusMatch && nameMatch && folderMatch) {
                    // We found an orphaned document and a new debug session started that can now own it
                    debug &&
                        console.log(`New debug session ${sessionId} => ${doc.sessionId} webview = ${doc.inWebview}`);
                    doc.sessionId = sessionId;
                    doc.sessionName = sessionName;
                    doc.wsFolder = isInvalidSessionFolder && doc.wsFolder ? doc.wsFolder : wsFolder; // Keep old valid folder if new is invalid
                    doc.sessionStatus = DocDebuggerStatus.Busy;
                    doc.memory.deleteHistory();
                    if (status === 'stopped') {
                        doc.markAsStale();
                        doc.sessionStatus = DocDebuggerStatus.Stopped;
                    }
                }
            } else if (status !== 'initializing') {
                doc.isReady = status === 'stopped';
                if (status === 'stopped') {
                    doc.markAsStale();
                    doc.sessionStatus = DocDebuggerStatus.Stopped;
                } else if (status === 'terminated') {
                    doc.sessionStatus = DocDebuggerStatus.Default;
                    doc.memory.deleteHistory();
                } else {
                    doc.sessionStatus = DocDebuggerStatus.Busy;
                }
            }
            debug && console.log('old vs new status', oldStatus, doc.sessionStatus);
            if (doc === this.currentDoc && oldStatus !== doc.sessionStatus) {
                debug && console.log('emitting event on debugger status', doc.sessionStatus);
                doc.emitGlobalEvent(DualViewDocGlobalEventType.DebuggerStatus);
            }
        }
    }

    public markAllDocsStale() {
        for (const [_id, doc] of Object.entries(this.allDocuments)) {
            doc.markAsStale();
        }
    }
    
    public storeSerializableAll(includeMemories = false): IWebviewDocXfer[] {
        const docs = [];
        for (const [_key, value] of Object.entries(this.allDocuments)) {
            const doc = value.getSerializable(includeMemories);
            docs.push(doc);
        }
        return docs;
    }

    public restoreSerializableAll(documents: IWebviewDocXfer[]) {
        const newDocsMap = new Map<string, IWebviewDocXfer>();
        documents.forEach(d => newDocsMap.set(d.docId, d));

        // Remove missing docs
        for (const docId of Object.keys(this.allDocuments)) {
            if (!newDocsMap.has(docId)) {
                this.removeDocument(docId);
            }
        }

        let lastDoc: DualViewDoc | undefined;
        for (const item of documents) {
            let doc = this.allDocuments[item.docId];
            if (doc) {
                doc.updateFromSerializable(item);
            } else {
                const xferObj = item as IWebviewDocXfer;
                doc = new DualViewDoc(xferObj, this);
                doc.isReady = false;
            }
            lastDoc = doc;
            if (item.isCurrentDoc) {
                this.setCurrentDoc(doc);
            }
        }
        if (DualViewDoc.InWebview() && Object.getOwnPropertyNames(this.allDocuments).length === 0) {
            lastDoc = DualViewDoc.createDummyDoc(this);
        }
        if (!this.currentDoc && lastDoc) {
            this.setCurrentDoc(lastDoc);
        }
    }
}

export class DualViewDoc {
    public baseAddress = 0n;
    private modifiedMap: Map<bigint, number> = new Map<bigint, number>();
    public startAddress = 0n;
    public maxAddress = 0n;
    public displayName: string;
    public expr: string;
    public size: string;
    public endian: EndianType;
    public format: RowFormatType;
    public column: string;
    public bytesPerRow: number;
    public maxBytes = 4n * 1024n * 1024n;
    public isReadonly: boolean;
    public readonly docId: string;
    public sessionId: string;
    public sessionName: string;
    public wsFolder: string;
    public readonly inWebview: boolean;
    private clientState: { [key: string]: any };
    public sessionStatus: DocDebuggerStatus = DocDebuggerStatus.Default;
    private startAddressStale = true;
    private maxBytesStale = true;

    // DO NOT CHANGE PageSize w/o adjusting getPageEventId to make sure we don't create too
    // many event listeners to an address change SubPageSize so that we result in less than 10
    // listeners per SubPageSize
    public PageSize: number;
    public SubPageSize: number;

    // This part is serialized/deserialized on demand
    public memory: MemPages;
    public isReady = false;
    public manager: DocumentManager;

    constructor(info: IWebviewDocXfer, manager: DocumentManager) {
        this.manager = manager;
        this.docId = info.docId;
        this.setAddresses(BigInt(info.startAddress), BigInt(info.maxBytes));
        this.displayName = info.displayName;
        this.expr = info.expr;
        this.size = info.size;
        this.endian = info.endian ?? 'little';
        this.format = info.format ?? '4-byte';
        this.column = info.column ?? '4';
        this.bytesPerRow = this.getBytesPerCell(this.format) * Number(this.column),
        this.wsFolder = info.wsFolder;
        this.sessionId = info.sessionId;
        this.sessionName = info.sessionName;
        this.isReadonly = info.isReadOnly;
        this.inWebview = DualViewDoc.InWebview();
        this.startAddressStale = info.baseAddressStale;
        this.maxBytesStale = info.maxBytesStale;
        this.PageSize = 16 * this.bytesPerRow;
        this.SubPageSize = this.PageSize / 8;
        if (info.modifiedMap) {
            // This map can contain values are are not actually yet in our memory
            for (const [key, value] of Object.entries(info.modifiedMap)) {
                this.modifiedMap.set(BigInt(key), value);
            }
        }
        this.memory = info.memory ? MemPages.restoreSerializable(info.memory, this) : new MemPages(this);
        // console.log(info.clientState);
        this.clientState = info.clientState || {};
        this.manager.addDocument(this, !!info.isCurrentDoc);
    }


    updateFromSerializable(info: IWebviewDocXfer) {
        const oldStartAddress = this.startAddress;
        const oldPageSize = this.PageSize;
        this.setAddresses(BigInt(info.startAddress), BigInt(info.maxBytes));
        this.displayName = info.displayName;
        this.expr = info.expr;
        this.size = info.size;
        this.endian = info.endian ?? 'little';
        this.format = info.format ?? '4-byte';
        this.column = info.column ?? '4';
        this.bytesPerRow = this.getBytesPerCell(this.format) * Number(this.column);
        this.wsFolder = info.wsFolder;
        this.sessionId = info.sessionId;
        this.sessionName = info.sessionName;
        this.isReadonly = info.isReadOnly;
        this.startAddressStale = info.baseAddressStale;
        this.maxBytesStale = info.maxBytesStale;
        this.PageSize = 16 * this.bytesPerRow;
        this.SubPageSize = this.PageSize / 8;
        
        if (info.memory) {
            this.memory = MemPages.restoreSerializable(info.memory, this);
        } else if (this.startAddress !== oldStartAddress || (oldPageSize && this.PageSize !== oldPageSize)) {
            this.memory = new MemPages(this);
        } else if (this.startAddressStale || this.maxBytesStale) {
            this.memory.markAllStale();
        }

        this.modifiedMap.clear();
        if (info.modifiedMap) {
            for (const [key, value] of Object.entries(info.modifiedMap)) {
                this.modifiedMap.set(BigInt(key), value);
            }
        }
        
        if (this.startAddressStale) {
            this.getStartAddress();
        }
        if (this.maxBytesStale) {
            this.getMaxBytes();
        }
        
        this.emitGlobalEvent(DualViewDocGlobalEventType.CurrentDoc);
    }

    static InWebview() {
        return isInWebview();
    }

    getBytesPerCell(format : RowFormatType): 1 | 2 | 4 | 8 {
        switch (format) {
            case '1-byte': {
                return 1;
                break;
            }
            case '2-byte': {
                return 2;
                break;
            }
            case '4-byte': {
                return 4;
                break;
            }
            case '8-byte': {
                return 8;
                break;
            }
            default: {
                console.error('Invalid format');
                return 1;
                break;
            }
        }
    }

    setAddresses(startAddress: bigint, maxBytes: bigint) {
        this.startAddress = startAddress;
        this.maxBytes = maxBytes;
        this.baseAddress = this.startAddress;
        this.maxAddress = this.baseAddress + this.maxBytes;
    }

    updateSettings(settings: IModifiableProps) {
        if ((this.expr !== settings.expr) || (this.size !== settings.size)) {
            this.expr = settings.expr;
            this.size = settings.size;
            this.markAsStale();
        }
        this.displayName = settings.displayName;
        this.endian = settings.endian;
        this.format = settings.format;
        this.column = settings.column;
        this.bytesPerRow = this.getBytesPerCell(this.format) * Number(this.column);
        this.PageSize = 16 * this.bytesPerRow;
        this.SubPageSize = this.PageSize / 8;
        // Now everything is out of sync. Requires a total re-render it is the callers responsibility to do that
    }

    async setClientState<T>(key: string, value: T) {
        this.clientState[key] = value;
        if (this.inWebview) {
            const cmd: ICmdClientState = {
                state: this.clientState,
                type: CmdType.SaveClientState,
                sessionId: this.sessionId,
                docId: this.docId
            };
            await vscodePostCommandNoResponse(cmd);
        }
    }

    getClientState<T>(key: string, def: T): T {
        const v = this.clientState[key];
        return v === undefined ? def : v;
    }

    setClientStateAll(state: { [key: string]: any }) {
        // Only used in VSCode
        this.clientState = state;
    }

    async getStartAddress(): Promise<bigint> {
        if (!this.startAddressStale) {
            return Promise.resolve(this.startAddress);
        }
        if (this.sessionStatus !== DocDebuggerStatus.Stopped) {
            return Promise.resolve(this.startAddress);
        }
        const arg: ICmdGetStartAddress = {
            expr: this.expr,
            def: this.startAddress.toString(),
            type: CmdType.GetStartAddress,
            sessionId: this.sessionId,
            docId: this.docId
        };
        try {
            const str = await this.manager.memoryIF!.getStartAddress(arg);
            const newVal = BigInt(str);
            if (newVal != this.startAddress) {
                this.setAddresses(newVal, this.maxBytes);
                // Address changed, so old memory history is invalid for the new address range.
                // We must reset the memory pages to avoid showing "diffs" against unrelated data.
                this.memory = new MemPages(this);
                this.emitGlobalEvent(DualViewDocGlobalEventType.BaseAddress);
            }
        } catch {}
        this.startAddressStale = false;
        return Promise.resolve(this.startAddress);
    }

    async getMaxBytes(): Promise<bigint> {
        if (!this.maxBytesStale) {
            return Promise.resolve(this.maxBytes);
        }
        if (this.sessionStatus !== DocDebuggerStatus.Stopped) {
            return Promise.resolve(this.maxBytes);
        }
        const arg: ICmdGetMaxBytes = {
            expr: this.size,
            def: this.maxBytes.toString(),
            type: CmdType.GetMaxBytes,
            sessionId: this.sessionId,
            docId: this.docId
        };
        try {
            const str = await this.manager.memoryIF!.getMaxBytes(arg);
            const newVal = BigInt(str);
            if (newVal != this.maxBytes) {
                this.setAddresses(this.startAddress, newVal);
                this.memory.markAllStale();
                this.emitGlobalEvent(DualViewDocGlobalEventType.BaseAddress);
            }
        } catch {}
        this.maxBytesStale = false;
        return Promise.resolve(this.maxBytes);
    }

    async getMemoryPage(addr: bigint, nBytes: number): Promise<Uint8Array> {
        let ary = !this.inWebview && !this.isReady ? this.memory.getPage(addr) : this.memory.getPageIfFresh(addr);
        if (ary) {
            return Promise.resolve(ary);
        }
        ary = undefined;
        try {
            ary = await this.getMemoryPageFromSource(addr, nBytes);
        } catch (e) {}
        if (!ary) {
            ary = new Uint8Array(0); // TODO: This should not happen
        } else if (ary.length > 0) {
            this.memory.setPage(addr, ary);
        }
        return Promise.resolve(ary);
    }

    async setExprPage(expr: string, value: string, nBytes: number): Promise<string> {
        let ary = undefined;
        try {
            ary = await this.setExprToSource(expr, value, nBytes);
        } catch (e) {}
        if (!ary) {
            ary = '0';
        }
        return Promise.resolve(ary);
    }

    public getMemoryRaw(): MemPages {
        return this.memory;
    }

    public refreshMemoryIfStale(): Promise<any> {
        return this.memory.refreshMemoryIfStale();
    }

    public ensureAllPagesLoaded(): Promise<any> {
        return this.memory.ensureAllPagesLoaded();
    }

    public markAsStale() {
        this.startAddressStale = true;
        this.maxBytesStale = true;
        this.memory.markAllStale();
    }

    private pendingRequests: { [key: string]: Promise<Uint8Array> } = {};
    getMemoryPageFromSource(addr: bigint, nBytes: number): Promise<Uint8Array> {
        const key = addr.toString();
        const pendingPromise = this.pendingRequests[key];
        if (pendingPromise) {
            return pendingPromise;
        }
        // eslint-disable-next-line no-async-promise-executor
        const promise = new Promise<Uint8Array>(async (resolve) => {
            try {
                if (this.startAddressStale) {
                    await this.getStartAddress();
                }
                if (this.maxBytesStale) {
                    await this.getMaxBytes();
                }

                const available = Number(this.maxAddress - addr);
                const count = Math.min(nBytes, available);
                
                if (count <= 0) {
                     resolve(new Uint8Array(0));
                     return;
                }

                const msg: ICmdGetMemory = {
                    type: CmdType.GetMemory,
                    sessionId: this.sessionId,
                    docId: this.docId,
                    seq: 0,
                    addr: addr.toString(),
                    count: count
                };

                const ret = await this.manager.memoryIF!.getMemory(msg);
                resolve(ret);
            } catch (e) {
                console.error('Error getting memory address or value', e);
                resolve(new Uint8Array(0));
            }
            delete this.pendingRequests[key];
        });
        this.pendingRequests[key] = promise;
        return promise;
    }

    addrInRange(addr: bigint): boolean {
        return addr >= this.baseAddress && addr <= this.maxAddress;
    }

    private static first = true;
    async getByte(addr: bigint): Promise<IMemValue> {
        if (this.addrInRange(addr)) {
            const orig = await this.memory.getValue(addr);
            if (DualViewDoc.first && orig.current < 0) {
                DualViewDoc.first = false;
                // debugger;
            }
            const v = this.modifiedMap.get(addr);
            const modified = v === undefined ? orig.current : v;
            const ret: IMemValue = {
                cur: modified,
                orig: orig.current,
                stale: this.memory.isStale(addr),
                changed: orig.current !== orig.previous || modified !== orig.current,
                inRange: true
            };
            return ret;
        }
        return DummyByte;
    }

    getRowUnsafe(addr: bigint): IMemValue[] {
        const bytesPerRow = this.bytesPerRow || 16;
        if (this.addrInRange(addr)) {
            const origRow = this.memory.getRowSync(addr, BigInt(bytesPerRow));
            const isStale = this.memory.isStale(addr);
            const ret: IMemValue[] = [];
            for (const orig of origRow) {
                const v = this.modifiedMap.get(addr);
                const modified = v === undefined ? orig.current : v;
                const tmp: IMemValue = {
                    cur: modified,
                    orig: orig.current,
                    stale: isStale,
                    changed: orig.current !== orig.previous || modified !== orig.current,
                    inRange: orig.current >= 0
                };
                ret.push(tmp);
                addr++;
            }
            return ret;
        } else {
            const ret: IMemValue[] = [];
            for (let ix = 0; ix < bytesPerRow; ix++) {
                ret.push(DummyByte);
            }
            return ret;
        }
    }

    setExprToSource(expr: string, value: string, nBytes: number): Promise<string> {
        const msg: ICmdSetExpr = {
            type: CmdType.SetExpr,
            sessionId: this.sessionId,
            docId: this.docId,
            seq: 0,
            expr: expr,
            val: value,
            count: nBytes
        };
        // eslint-disable-next-line no-async-promise-executor
        const promise = new Promise<string>(async (resolve) => {
            try {
                const ret = await this.manager.memoryIF!.setExpr(msg);
                resolve(ret);
            } catch (e) {
                console.error('Error setting expression', e);
                resolve('0');
            }
        });
        return promise;
    }

    // Only for webviews. Will fail on VSCode side -- use setByteLocal() instead
    async setByte(addr: bigint, val: number) {
        const old = this.setByteLocal(addr, val);
        const cmd: ICmdSetByte = {
            addr: addr.toString(),
            value: old === val ? -1 : val,
            type: CmdType.SetByte,
            sessionId: this.sessionId,
            docId: this.docId
        };
        await vscodePostCommandNoResponse(cmd);
    }

    async setExpr(addr: bigint, val: string, nBytes: number) {
        const cmd: ICmdSetExpr = {
            expr: addr.toString(),
            val: val,
            count: nBytes,
            type: CmdType.SetExpr,
            sessionId: this.sessionId,
            docId: this.docId
        };
        await vscodePostCommandNoResponse(cmd);
    }

    static getFavoriteInfo(name: string): Promise<any> {
        const cmd: ICmdOpenFavorite = {
            name: name,
            type: CmdType.GetFavoriteInfo,
            sessionId: UnknownDocId,
            docId: UnknownDocId,
        };
        return vscodePostCommand(cmd);
    }

    static openFavorite(name: string): Promise<any> {
        const cmd: ICmdOpenFavorite = {
            name: name,
            type: CmdType.OpenFavorite,
            sessionId: UnknownDocId,
            docId: UnknownDocId,
        };
        return vscodePostCommand(cmd);
    }

    static addFavorite(info?: IAddMemoryInfo): Promise<any> {
        const cmd: any = {
            type: CmdType.AddFavorite,
            sessionId: UnknownDocId,
            docId: UnknownDocId,
            info: info
        };
        return vscodePostCommand(cmd);
    }

    static deleteFavorite(name: string): Promise<any> {
        const cmd: ICmdOpenFavorite = {
            name: name,
            type: CmdType.DeleteFavorite,
            sessionId: UnknownDocId,
            docId: UnknownDocId,
        };
        return vscodePostCommand(cmd);
    }

    static importFavorites(): Promise<any> {
        const cmd: ICmdBase = {
            type: CmdType.ImportFavorites,
            sessionId: UnknownDocId,
            docId: UnknownDocId,
        };
        return vscodePostCommand(cmd);
    }

    static exportFavorites(): Promise<any> {
        const cmd: ICmdBase = {
            type: CmdType.ExportFavorites,
            sessionId: UnknownDocId,
            docId: UnknownDocId,
        };
        return vscodePostCommand(cmd);
    }

    setByteLocal(addr: bigint, val: number): number {
        const old = this.memory.getValueSync(addr);
        if (old === val) {
            this.modifiedMap.delete(addr);
        } else {
            this.modifiedMap.set(addr, val);
        }
        return old;
    }


    private statusChangeTimeout: NodeJS.Timeout | undefined;
    private pendingArg: IDualViewDocGlobalEventArg | undefined;
    public emitGlobalEvent(type: DualViewDocGlobalEventType) {
        const debug = false;
        if (!this.inWebview) {
            debug && console.log('emitGlobalEvent early return because not in webview');
            return;
        }
        if (this !== this.manager.currentDoc) {
            debug && console.log('emitGlobalEvent early return because not current doc');
            return;
        }

        // Not sure why but we have to debounce the event changes. Or React states
        // don't update properly. It seems not use the latest change if it sees a
        // a -> b -> a as not a state change if it happens too rapidly. May also
        // save flickering if we debounce.
        if (this.statusChangeTimeout) {
            debug && console.log('emitGlobalEvent Canceling event', this.pendingArg);
            clearTimeout(this.statusChangeTimeout);
        }
        const arg: IDualViewDocGlobalEventArg = {
            type: type,
            docId: this.docId,
            sessionId: this.sessionId,
            sessionStatus: this.sessionStatus,
            baseAddress: this.baseAddress,
            maxBytes: this.maxBytes
        };
        this.pendingArg = arg;
        this.statusChangeTimeout = setTimeout(() => {
            this.statusChangeTimeout = undefined;
            debug && console.log('emitGlobalEvent Emitting event', arg);
            this.manager.globalEventEmitter.emit(arg.type, arg);
            this.manager.globalEventEmitter.emit('any', arg);
        }, 1); // Is this enough delay?!?!? If the delay is too much, we miss status changes totally.
        // We should try to remove the debounce stuff completely
    }

    isModified(): boolean {
        return !isEmpty(this.modifiedMap);
    }

    getSerializable(includeMemories = false): IWebviewDocXfer {
        const newMap: ModifiedXferMap = {};
        this.modifiedMap.forEach((value, key) => {
            newMap[key.toString()] = value;
        });
        const tmp: IWebviewDocXfer = {
            docId: this.docId,
            sessionId: this.sessionId,
            sessionName: this.sessionName,
            displayName: this.displayName,
            expr: this.expr,
            endian: this.endian,
            format: this.format,
            column: this.column,
            size: this.size,
            wsFolder: this.wsFolder,
            startAddress: this.startAddress.toString(),
            maxBytes: this.maxBytes.toString(),
            isCurrentDoc: this === this.manager.currentDoc,
            modifiedMap: newMap,
            clientState: this.clientState,
            baseAddressStale: this.startAddressStale,
            maxBytesStale: this.maxBytesStale,
            isReadOnly: this.isReadonly
        };
        if (includeMemories) {
            tmp.memory = this.memory.getSerializablePages();
        }
        return tmp;
    }


    public static createDummyDoc(manager: DocumentManager): DualViewDoc {
        const initString =
            'Add a new view  ' +
            'using the plus  ' +
            'button in the   ' +
            'Toolbar with the' +
            'debugger paused ' +
            'Supported       ' +
            'debuggers: cspy,' +
            'cortex-debug,   ' +
            'cppdbg';
        const tmp: IWebviewDocXfer = {
            docId: UnknownDocId,
            sessionId: UnknownDocId,
            sessionName: UnknownDocId,
            expr: UnknownDocId,
            displayName: 'No memory views',
            wsFolder: '.',
            startAddress: '0',
            endian: 'little',
            format: '1-byte',
            column: '16',
            size: '4 * 1024 * 1024',
            maxBytes: initString.length.toString(),
            isCurrentDoc: true,
            clientState: {},
            baseAddressStale: true,
            maxBytesStale: true,
            isReadOnly: true
        };
        const doc = new DualViewDoc(tmp, manager);
        doc.memory.createDummyPage(initString /*.replace(/ /g, '-')*/);
        return doc;
    }

    public async searchMemory(pattern: string): Promise<bigint[]> {
        // 1. Prepare for Content Search
        let hexPattern = pattern.trim();
        hexPattern = hexPattern.replace(/\s/g, '');
        
        // Remove 0x prefix if present
        if (hexPattern.toLowerCase().startsWith('0x')) {
            hexPattern = hexPattern.substring(2);
        }

        // 2. Try Local Visual Content Search
        // Check if it is a valid hex string
        if (/^[0-9A-Fa-f]+$/.test(hexPattern)) {
            if (this.manager.currentDoc && this.manager.currentDoc.memory) {
                 const bytesPerCell = this.manager.currentDoc.getBytesPerCell(this.manager.currentDoc.format);
                 const isBigEndian = this.manager.currentDoc.endian === 'big';
                 
                 return this.manager.currentDoc.memory.searchVisual(hexPattern, bytesPerCell, isBigEndian);
            }
        }

        return [];
    }
}

function isEmpty(obj: any) {
    for (const prop in obj) {
        // eslint-disable-next-line no-prototype-builtins
        if (obj.hasOwnProperty(prop)) return false;
    }

    return true;
}

interface IMemPage {
    stale: boolean;
    current: Uint8Array;
    previous?: Uint8Array | undefined;
}
class MemPages {
    constructor(private parentDoc: DualViewDoc, private pages: IMemPage[] = []) {}

    get baseAddress(): bigint {
        return this.parentDoc.baseAddress;
    }

    get maxAddress(): bigint {
        return this.parentDoc.maxAddress;
    }

    public numPages(): number {
        return this.pages.length;
    }

    public searchVisual(pattern: string, bytesPerCell: number, isBigEndian: boolean): bigint[] {
        const pageSize = this.parentDoc.PageSize || 512;
        pattern = pattern.toLowerCase();
        const results: bigint[] = [];

        for (let i = 0; i < this.pages.length; i++) {
            const page = this.pages[i];
            if (!page || page.stale || !page.current || page.current.length === 0) {
                continue;
            }
            
            const buf = page.current;
            const pageAddr = this.baseAddress + BigInt(i * pageSize);

            // Iterate by cell to match the visual representation
            for (let offset = 0; offset <= buf.length - bytesPerCell; offset += bytesPerCell) {
                let hexStr = '';
                if (isBigEndian) {
                    for(let k=0; k<bytesPerCell; k++) {
                        hexStr += buf[offset + k].toString(16).padStart(2, '0');
                    }
                } else {
                    for(let k=bytesPerCell-1; k>=0; k--) {
                        hexStr += buf[offset + k].toString(16).padStart(2, '0');
                    }
                }

                if (hexStr.includes(pattern)) {
                    results.push(pageAddr + BigInt(offset));
                }
            }
        }
        return results;
    }

    createDummyPage(str: string) {
        const tmp: IMemPage = {
            stale: false,
            current: new Uint8Array(Buffer.from(str))
        };
        this.pages.push(tmp);
    }

    private getSlot(addr: bigint): number {
        const offset = addr - this.baseAddress;
        const slot = Math.floor(Number(offset) / (this.parentDoc.PageSize || 512));
        return slot;
    }

    public ensureAllPagesLoaded(): Promise<any> {
        const totalBytes = Number(this.parentDoc.maxBytes);
        const pageSize = this.parentDoc.PageSize || 512;
        const numPages = Math.ceil(totalBytes / pageSize);
        this.growPages(numPages - 1);

        const promises = [];
        let addr = this.baseAddress;
        for (let i = 0; i < numPages; i++) {
            promises.push(this.getValue(addr));
            addr += BigInt(pageSize);
        }
        return Promise.all(promises);
    }

    public refreshMemoryIfStale(): Promise<any> {
        const promises = [];
        let addr = this.baseAddress;
        for (const page of this.pages) {
            if (page.stale) {
                promises.push(this.getValue(addr));
            }
            addr += BigInt(this.parentDoc.PageSize || 512);
        }
        return Promise.all(promises);
    }

    public markAllStale() {
        for (const page of this.pages) {
            page.stale = true;
        }
    }

    public deleteHistory() {
        for (const page of this.pages) {
            delete page.previous;
        }
    }

    public getPageEventId(addr: bigint): string {
        const slot = this.getSlot(addr);
        const subSlot = Math.floor(Number(addr - this.baseAddress) / (this.parentDoc.SubPageSize || 64));
        const ret = `address-${slot}-${subSlot}`;
        return ret;
    }

    getPageIfFresh(addr: bigint): Uint8Array | undefined {
        const slot = this.getSlot(addr);
        return slot >= 0 && slot < this.pages.length && !this.pages[slot].stale ? this.pages[slot].current : undefined;
    }

    getPage(addr: bigint): Uint8Array | undefined {
        const slot = this.getSlot(addr);
        return slot >= 0 && slot < this.pages.length ? this.pages[slot].current : undefined;
    }

    setPage(addr: bigint, ary: Uint8Array, dbgCaller = 'MemPages.getValue') {
        if (this.parentDoc.getMemoryRaw() !== this) {
            // This MemPages instance is stale (replaced by a new one), so ignore updates
            return;
        }
        // eslint-disable-next-line no-constant-condition
        if (false) {
            const addrStr = hexFmt64(addr);
            console.log(
                `${dbgCaller}, addr=${addrStr}, buf-length = ${ary.length}, Updating page, Webview = ${this.parentDoc.inWebview}`
            );
        }
        const slot = this.getSlot(addr);
        if (slot < 0) {
            console.error(`MemPages.setPage: Invalid slot ${slot} for address ${addr} (base: ${this.baseAddress})`);
            return;
        }
        this.growPages(slot);
        const page = this.pages[slot];
        if (this.parentDoc.inWebview && page.stale && page.current.length) {
            page.previous = page.current;
        }
        page.current = ary;
        page.stale = false;
    }

    public isStale(addr: bigint): boolean {
        const slot = this.getSlot(addr);
        return slot >= 0 && slot < this.pages.length ? this.pages[slot].stale : true;
    }

    public getValueSync(addr: bigint): number {
        const slot = this.getSlot(addr);
        const page: IMemPage | undefined = slot >= 0 && slot < this.pages.length ? this.pages[slot] : undefined;
        const pageAddr = this.baseAddress + BigInt(slot * (this.parentDoc.PageSize || 512));
        const offset = Number(addr - pageAddr);
        const buf = page ? page.current : undefined;
        return buf && offset < buf.length ? buf[offset] : -1;
    }

    public getRowSync(addr: bigint, bytesPerRow: bigint): IByteVal[] {
        addr = this.baseAddress + (((addr - this.baseAddress) / bytesPerRow) * bytesPerRow);
        const slot = this.getSlot(addr);
        const page: IMemPage | undefined = slot >= 0 && slot < this.pages.length ? this.pages[slot] : undefined;
        const pageAddr = this.baseAddress + BigInt(slot * (this.parentDoc.PageSize || 512));
        let offset = Number(addr - pageAddr);
        const buf = page?.current;
        const pBuf = page?.previous;
        const ret: IByteVal[] = [];
        for (let ix = 0; ix < bytesPerRow; ix++, offset++) {
            const current = buf && offset < buf.length ? buf[offset] : -1;
            const previous = pBuf && offset < pBuf.length ? pBuf[offset] : current;
            ret.push({ current: current, previous: previous });
        }
        return ret;
    }

    private first = true;
    public getValue(addr: bigint): IByteVal | Promise<IByteVal> {
        const slot = this.getSlot(addr);
        let page: IMemPage | undefined = slot >= 0 && slot < this.pages.length ? this.pages[slot] : undefined;
        const pageAddr = this.baseAddress + BigInt(slot * (this.parentDoc.PageSize || 512));
        const get = (): IByteVal => {
            const offset = Number(addr - pageAddr);
            const buf = page ? page.current : undefined;
            const current = buf && offset < buf.length ? buf[offset] : -1;
            let previous = current;
            if (this.first && current < 0) {
                this.first = false;
                // debugger;
            }
            if (page && page.previous && offset < page.previous.length) {
                previous = page.previous[offset];
            }
            const ret: IByteVal = {
                previous: previous,
                current: current
            };
            return ret;
        };
        if (!page || page.stale || !page.current.length) {
            this.growPages(slot);
            return new Promise((resolve) => {
                // Prevent load more than the input size
                this.parentDoc
                    .getMemoryPageFromSource(pageAddr, (this.parentDoc.PageSize || 512))
                    .then((buf) => {
                        page = this.pages[slot];
                        if (page.stale) {
                            this.setPage(pageAddr, buf);
                        }
                        resolve(get());
                    })
                    .catch((e) => {
                        console.error('getMemory Failed', e);
                        resolve({ current: -1, previous: -1 });
                    });
            });
        } else {
            return get();
        }
    }

    private growPages(slot: number) {
        for (let i = this.pages.length; i <= slot; i++) {
            const page: IMemPage = {
                stale: true,
                current: new Uint8Array(0)
            };
            this.pages.push(page);
        }
    }

    setValue(addr: bigint, val: number /* byte actually */, useThrow = false): void {
        const slot = this.getSlot(addr);
        const pageAddr = this.baseAddress + BigInt(slot * (this.parentDoc.PageSize || 512));
        const page: IMemPage | undefined = slot >= 0 && slot < this.pages.length ? this.pages[slot] : undefined;
        const offset = Number(addr - pageAddr);
        if (!page || offset < 0 || offset >= page.current.length) {
            if (useThrow) {
                const maxAddr = this.baseAddress + BigInt(this.pages.length * (this.parentDoc.PageSize || 512));
                throw new Error(
                    `Requested address ${addr}. base address = ${this.baseAddress}, max address = ${maxAddr}`
                );
            }
        } else {
            const buf = this.pages[slot].current;
            buf[offset] = val;
        }
    }

    public getSerializablePages(): IMemPages {
        const ret: IMemPages = {
            baseAddress: this.baseAddress.toString(),
            pages: this.pages.map((p) => {
                return Array.from(p.current);
            })
        };
        return ret;
    }

    static restoreSerializable(obj: IMemPages, parent: DualViewDoc): MemPages {
        const newPages: IMemPage[] = [];
        for (const page of obj.pages) {
            const newPage: IMemPage = {
                stale: true,
                current: new Uint8Array(page)
            };
            newPages.push(newPage);
        }
        const ret = new MemPages(parent, newPages);
        // console.log(ret.pages);
        return ret;
    }
}

export interface IMemPages {
    baseAddress: string;
    pages: number[][];
}
