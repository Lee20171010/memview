import * as React from 'react';
import { DocDebuggerStatus, DualViewDoc, IDualViewDocGlobalEventArg } from './dual-view-doc';
import {
    VSCodeButton,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeTextField
} from '@vscode/webview-ui-toolkit/react';
import { vscodePostCommandNoResponse } from './webview-globals';
import {
    CmdButtonName,
    CmdType,
    EndianType,
    ICmdButtonClick,
    ICmdSettingsChanged,
    ICmdAddMemoryView,
    IModifiableProps,
    IAddMemoryInfo,
    RowFormatType,
    UnknownDocId,
    IFavoriteInfo
} from './shared';
import { SelContext } from './selection';

export interface IMemViewPanelProps {
    junk: string;
}

interface IMemViewPanelState {
    width: number;
    sessionId: string;
    sessionStatus: DocDebuggerStatus;
    docId: string;
}

export class MemViewToolbar extends React.Component<IMemViewPanelProps, IMemViewPanelState> {
    constructor(props: IMemViewPanelProps) {
        super(props);
        this.state = {
            width: window.innerWidth,
            sessionId: DualViewDoc.currentDoc?.sessionId || UnknownDocId,
            sessionStatus: DualViewDoc.currentDoc?.sessionStatus || DocDebuggerStatus.Default,
            docId: DualViewDoc.currentDoc?.docId || UnknownDocId
        };
        window.addEventListener('resize', this.onResize.bind(this));
        DualViewDoc.globalEventEmitter.addListener('any', this.onGlobalEvent.bind(this));
    }

    private onGlobalEvent(arg: IDualViewDocGlobalEventArg) {
        // false && console.log('MemViewToolbar.onGlobalEvent', arg);
        const newState: IMemViewPanelState = { ...this.state };
        if (arg.docId && arg.docId !== this.state.docId) {
            newState.docId = arg.docId;
        }
        if (arg.sessionId && arg.sessionId !== this.state.sessionId) {
            newState.sessionId = arg.sessionId;
        }
        if (arg.sessionStatus && arg.sessionStatus !== this.state.sessionStatus) {
            newState.sessionStatus = arg.sessionStatus;
        }
        this.setState(newState);
    }

    private onResizeTimeout: NodeJS.Timeout | undefined;
    onResize() {
        if (this.onResizeTimeout) {
            // console.log('Toolbar resize clearing timeout');
            clearTimeout(this.onResizeTimeout);
        }
        this.onResizeTimeout = setTimeout(() => {
            this.onResizeTimeout = undefined;
            // Just a dummy state to fore a redraw to re-render right justified elements
            // console.log('Window width = ', window.innerWidth);
            if (this.state.width !== window.innerWidth) {
                this.setState({ width: window.innerWidth });
            }
        }, 100);
    }

    private createCmd(button: CmdButtonName) {
        const ret: ICmdButtonClick = {
            button: button,
            type: CmdType.ButtonClick,
            sessionId: this.state.sessionId,
            docId: this.state.docId
        };
        return ret;
    }

    private onClickAddFunc = this.onClickAdd.bind(this);
    private onClickAdd(event: any) {
        AddPopupView.open(event);
    }
    private onAddInputDoneFunc = this.onAddInputDone.bind(this);
    private onAddInputDone(info: IAddMemoryInfo | undefined) {
        if (info && DualViewDoc.currentDoc) {
            const cmd: ICmdAddMemoryView = {
                info: info,
                type: CmdType.AddNewMemoryView,
                sessionId: DualViewDoc.currentDoc.sessionId,
                docId: DualViewDoc.currentDoc.docId
            };
            vscodePostCommandNoResponse(cmd);
        }
    }

    private onClickCloseFunc = this.onClickClose.bind(this);
    private onClickClose() {
        if (this.state.docId !== UnknownDocId) {
            vscodePostCommandNoResponse(this.createCmd('close'));
        }
    }

    private onClickSaveFunc = this.onClickSave.bind(this);
    private onClickSave() {
        console.log('In onClickSave');
    }

    private onClickRefreshFunc = this.onClickRefresh.bind(this);
    private onClickRefresh() {
        vscodePostCommandNoResponse(this.createCmd('refresh'));
    }

    private onClickSettingsFunc = this.onClickSettings.bind(this);
    private onClickSettings() {
        console.log('In onClickSettings');
    }

    private currentDocChangedFunc = this.currentDocChanged.bind(this);
    private currentDocChanged(event: any) {
        // eslint-disable-next-line no-debugger
        const value = event?.target?.value;
        console.log(`In currentDocChanged ${value}`);
        if (value && value !== UnknownDocId) {
            const cmd = this.createCmd('select');
            cmd.docId = value; // Other items in cmd don't matter
            cmd.sessionId = '';
            vscodePostCommandNoResponse(cmd);
        }
    }

    private getViewProps(): IModifiableProps {
        const props: IModifiableProps = {
            expr: DualViewDoc.currentDoc?.expr || '0',
            size: DualViewDoc.currentDoc?.size || '4 * 1024 * 1024',
            displayName: DualViewDoc.currentDoc?.displayName || 'Huh?',
            endian: DualViewDoc.currentDoc?.endian || 'little',
            format: DualViewDoc.currentDoc?.format || '4-byte',
            column: DualViewDoc.currentDoc?.column || '8'
        };
        return props;
    }

    private onClickEditPropFunc = this.onClickEditProp.bind(this);
    private onClickEditProp(event: any) {
        ViewSettings.open(event, this.getViewProps());
    }
    private onEditPropsDoneFunc = this.onEditPropsDone.bind(this);
    private onEditPropsDone(props: IModifiableProps | undefined) {
        if (props && DualViewDoc.currentDoc) {
            const cmd: ICmdSettingsChanged = {
                settings: props,
                type: CmdType.SettingsChanged,
                sessionId: DualViewDoc.currentDoc.sessionId,
                docId: DualViewDoc.currentDoc.docId
            };
            vscodePostCommandNoResponse(cmd);
        }
    }

    private onClickCopyFunc = this.onClickCopy.bind(this);
    private onClickCopy(ev: React.MouseEvent) {
        if (ev.altKey) {
            vscodePostCommandNoResponse(this.createCmd('copy-all-to-clipboard'));
        } else {
            SelContext.current?.copyToClipboard();
        }
    }

    private onClickLoadAllFunc = this.onClickLoadAll.bind(this);
    private onClickLoadAll(_ev: React.MouseEvent) {
        vscodePostCommandNoResponse(this.createCmd('load-all'));
    }

    private onClickCopyToFileFunc = this.onClickCopyToFile.bind(this);
    private onClickCopyToFile(_ev: React.MouseEvent) {
        vscodePostCommandNoResponse(this.createCmd('copy-all-to-file'));
    }
    private onClickFavoriteFunc = this.onClickFavorite.bind(this);
    private onClickFavorite(ev: React.MouseEvent) {
        FavoritePopupView.open(ev);
    }

    render() {
        // console.log('In MemViewToolbar.render');
        const docItems = [];
        let count = 0;
        let status = 'No status';
        let enableProps = false;
        for (const doc of DualViewDoc.getBasicDocumentsList()) {
            docItems.push(
                <VSCodeOption key={count} selected={doc.isCurrent} value={doc.docId}>
                    {doc.displayName}
                </VSCodeOption>
            );
            status = doc.isCurrent ? doc.sessionStatus : status;
            enableProps = enableProps || doc.docId !== UnknownDocId;
            count++;
        }
        const isModified = DualViewDoc.currentDoc?.isModified;
        const isStopped = this.state.sessionStatus === DocDebuggerStatus.Stopped;
        const editProps: IViewSettingsProps = {
            settings: this.getViewProps(),
            onDone: this.onEditPropsDoneFunc
        };
        const addProps: IAddPopupViewProps = {
            onDone: this.onAddInputDoneFunc
        };
        let key = 0;
        const copyHelp =
            'Copy to clipboard.\nHold ' +
            (navigator.platform.startsWith('Mac') ? '⌥' : 'Alt') +
            ' for Copy All to clipboard';
        return (
            <div className='toolbar' style={{ width: 'auto' }}>
                <VSCodeDropdown
                    key={key++}
                    position='below'
                    value={this.state.docId}
                    onChange={this.currentDocChangedFunc}
                >
                    {docItems}
                </VSCodeDropdown>
                <span>&nbsp;</span>
                <VSCodeButton key={key++} appearance='icon' title='Add new memory view' onClick={this.onClickAddFunc}>
                    <span className='codicon codicon-add'></span>
                </VSCodeButton>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    title='Edit memory view properties'
                    disabled={!enableProps}
                    onClick={this.onClickEditPropFunc}
                >
                    <span className='codicon codicon-edit'></span>
                </VSCodeButton>
                <VSCodeButton key={key++} appearance='icon' title={copyHelp} onClick={this.onClickCopyFunc}>
                    <span className='codicon codicon-copy'></span>
                </VSCodeButton>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    title='Save to file...'
                    onClick={this.onClickCopyToFileFunc}
                >
                    <span className='codicon codicon-file-binary'></span>
                </VSCodeButton>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    title='Load all size'
                    onClick={this.onClickLoadAllFunc}
                >
                    <span className='codicon codicon-arrow-down'></span>
                </VSCodeButton>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    title='Save changes to program memory. Coming soon'
                    disabled={!isModified || !isStopped}
                    onClick={this.onClickSaveFunc}
                >
                    <span className='codicon codicon-save'></span>
                </VSCodeButton>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    title='Favorite memory views'
                    onClick={this.onClickFavoriteFunc}
                >
                    <span className='codicon codicon-heart'></span>
                </VSCodeButton>
                <VSCodeButton key={key++} appearance='icon' onClick={this.onClickRefreshFunc}>
                    <span
                        className='codicon codicon-refresh'
                        title='Refresh this panel. New data is fetched if debugger is stopped'
                    ></span>
                </VSCodeButton>
                <VSCodeButton key={key++} appearance='icon' onClick={this.onClickSettingsFunc}>
                    <span className='codicon codicon-gear' title='Edit global settings. Coming soon'></span>
                </VSCodeButton>
                <span className='debug-status'>Status: {status}</span>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    style={{ float: 'right' }}
                    title='Close this memory view'
                    disabled={this.state.docId === UnknownDocId}
                    onClick={this.onClickCloseFunc}
                >
                    <span className='codicon codicon-close'></span>
                </VSCodeButton>
                <VSCodeDivider key={key++} role='presentation'></VSCodeDivider>
                <ViewSettings {...editProps}></ViewSettings>
                <AddPopupView {...addProps}></AddPopupView>
                <FavoritePopupView></FavoritePopupView>
            </div>
        );
    }
}

interface IFavoritePopupViewState {
    isOpen: boolean;
    clientX: number;
    clientY: number;
    favoriteInfoAry: IFavoriteInfo[];
    renderedWidth?: number;
}

export class FavoritePopupView extends React.Component<{}, IFavoritePopupViewState> {
    static GlobalPtr: FavoritePopupView;
    private popupRef = React.createRef<HTMLDivElement>();

    constructor(props: {}) {
        super(props);
        this.state = {
            isOpen: false,
            clientX: 0,
            clientY: 0,
            favoriteInfoAry: []
        };
        FavoritePopupView.GlobalPtr = this;
    }

    static open(event: any) {
        event.preventDefault();
        const button = event.currentTarget;
        const rect = button.getBoundingClientRect();
        
        this.GlobalPtr.setState({
            isOpen: true,
            clientX: rect.left,
            clientY: rect.bottom
        });
        this.GlobalPtr.refreshFavorites();
    }

    private refreshFavorites() {
        DualViewDoc.getFavoriteInfo('')
        .catch((err) => {
            console.error('Failed to get favorite info', err);
            const failed: IFavoriteInfo[] = [];
            failed.push({ name: 'Load Failed' });
            this.setState({ favoriteInfoAry: failed });
        })
        .finally(() => {
            if (DualViewDoc.currentDoc) {
                this.setState({ favoriteInfoAry: DualViewDoc.favoriteInfoAry });
            }
        });
    }

    private onClickCloseFunc = this.onClickClose.bind(this);
    private onClickClose(event: any) {
        event && event.preventDefault();
        event && event.stopPropagation();
        this.setState({
            isOpen: false
        });
    }

    private onClickImportFunc = this.onClickImport.bind(this);
    private onClickImport(e: any) {
        e.stopPropagation();
        DualViewDoc.importFavorites();
        this.setState({ isOpen: false });
    }

    private onClickExportFunc = this.onClickExport.bind(this);
    private onClickExport(e: any) {
        e.stopPropagation();
        DualViewDoc.exportFavorites();
        this.setState({ isOpen: false });
    }

    private onClickAddFavoriteFunc = this.onClickAddFavorite.bind(this);
    private onClickAddFavorite(e: any) {
        e.stopPropagation();
        DualViewDoc.addFavorite();
        this.setState({ isOpen: false });
    }

    private onKeyDownSearchFunc = this.onKeyDownSearch.bind(this);
    private onKeyDownSearch(e: any) {
        e.stopPropagation();

        if (e.key === 'Enter') {
            DualViewDoc.getFavoriteInfo(e.target.value)
            .catch((err) => {
                console.error('Failed to get favorite info', err);
                const failed: IFavoriteInfo[] = [];
                failed.push({ name: 'Load Failed' });
                this.setState({ favoriteInfoAry: failed });
            })
            .finally(() => {
                if (DualViewDoc.currentDoc) {
                    this.setState({ favoriteInfoAry: DualViewDoc.favoriteInfoAry });
                }
            });
        } else if (e.key === 'Escape') {
            this.onClickClose(e);
        }
    }

    private onClickSearchFavoriteFunc = this.onClickSearchFavorite.bind(this);
    private onClickSearchFavorite(e: any) {
        e.stopPropagation();
    }

    private onSearchInputFunc = this.onSearchInput.bind(this);
    private onSearchInput(e: any) {
        const val = e.target.value;
        DualViewDoc.getFavoriteInfo(val).then((arg: any) => {
             if (DualViewDoc.currentDoc) {
                this.setState({ favoriteInfoAry: DualViewDoc.favoriteInfoAry });
            }
        });
    }

    private onClickFavoriteItemFunc = this.onClickFavoriteItem.bind(this);
    private onClickFavoriteItem(e: any) {
        e.stopPropagation();
        const name = e.target.value || e.currentTarget.value || e.target.textContent;
        if (name) {
            DualViewDoc.openFavorite(name);
            this.setState({ isOpen: false });
        }
    }

    private onClickDeleteFavoriteItemFunc = this.onClickDeleteFavoriteItem.bind(this);
    private onClickDeleteFavoriteItem(e: any) {
        e.stopPropagation();
        const name = e.currentTarget.value; 
        if (name) {
            DualViewDoc.deleteFavorite(name).then(() => {
                this.refreshFavorites();
            });
        }
    }

    componentDidUpdate() {
        if (this.state.isOpen && this.popupRef.current) {
            const width = this.popupRef.current.offsetWidth;
            if (width !== this.state.renderedWidth) {
                this.setState({ renderedWidth: width });
            }
        }
    }

    render() {
        let key = 0;
        const estimatedWidth = 400;
        const width = this.state.renderedWidth || estimatedWidth;
        const left = Math.max(0, Math.min(this.state.clientX, window.innerWidth - width - 20));
        return (
            <div key={key++} style={{ display: this.state.isOpen ? '' : 'none' }}>
                <div
                    key={key++}
                    className='popup'
                    ref={this.popupRef}
                    style={{
                        top: 0,
                        left: left,
                        marginTop: '0px',
                        display: 'flex',
                        flexDirection: 'column',
                        fontSize: 'small',
                        textAlign: 'left',
                        height: 'auto',
                        minWidth: '200px',
                        maxWidth: '400px',
                        width: 'auto',
                        padding: '5px',
                        gap: '5px',
                        backgroundColor: 'var(--vscode-editor-background)',
                        border: '1px solid var(--vscode-widget-border)',
                        zIndex: 1001,
                        position: 'fixed'
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0px' }}>
                        <div style={{ display: 'flex', gap: '2px' }}>
                            <VSCodeButton key={key++} appearance='icon' title='Import Favorites' onClick={this.onClickImportFunc}>
                                <span className='codicon codicon-cloud-upload'></span>
                            </VSCodeButton>
                            <VSCodeButton key={key++} appearance='icon' title='Export Favorites' onClick={this.onClickExportFunc}>
                                <span className='codicon codicon-cloud-download'></span>
                            </VSCodeButton>
                        </div>
                        <div style={{ display: 'flex', gap: '2px' }}>
                            <VSCodeButton
                                key={key++}
                                appearance='icon'
                                title='Add Favorite'
                                onClick={this.onClickAddFavoriteFunc}
                            >
                                <span className='codicon codicon-add'></span>
                            </VSCodeButton>
                            <VSCodeButton
                                key={key++}
                                appearance='icon'
                                title='Close'
                                onClick={this.onClickCloseFunc}
                            >
                                <span className='codicon codicon-close'></span>
                            </VSCodeButton>
                        </div>
                    </div>

                    <VSCodeTextField
                        key={key++}
                        placeholder='Search Favorites'
                        style={{ width: '100%' }}
                        onKeyDown={this.onKeyDownSearchFunc}
                        onClick={this.onClickSearchFavoriteFunc}
                        onInput={this.onSearchInputFunc}
                    >
                    </VSCodeTextField>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '5px', maxHeight: '150px', overflowY: 'auto', overflowX: 'hidden' }}>
                    {this.state.favoriteInfoAry.map((favoriteInfo) => {
                        return (
                            <div key={key++} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ flexGrow: 1, overflowX: 'auto', whiteSpace: 'nowrap', marginRight: '5px', minWidth: 0 }}>
                                    <VSCodeOption
                                        key={key++}
                                        style={{
                                            display: 'block',
                                            cursor: 'pointer',
                                            minWidth: 'max-content'
                                        }}
                                        value={favoriteInfo.name}
                                        onClick={this.onClickFavoriteItemFunc}
                                    >
                                        {favoriteInfo.name}
                                    </VSCodeOption>
                                </div>
                                <VSCodeButton
                                    key={key++}
                                    appearance='icon'
                                    title='Delete this Favorite'
                                    value={favoriteInfo.name}
                                    onClick={this.onClickDeleteFavoriteItemFunc}
                                    style={{ flexShrink: 0 }}
                                >
                                    <span className='codicon codicon-trash'></span>
                                </VSCodeButton>
                            </div>
                        );
                    })}
                    </div>
                </div>
                <div className='popup-background' onClick={this.onClickCloseFunc}></div>
            </div>
        );
    }
}

interface IViewSettingsProps {
    settings: IModifiableProps;
    onDone: (props: IModifiableProps | undefined) => void;
}

interface IViewSettingsState {
    settings: IModifiableProps;
    isOpen: boolean;
    clientX: number;
    clientY: number;
    renderedWidth?: number;
}
export class ViewSettings extends React.Component<IViewSettingsProps, IViewSettingsState> {
    static GlobalPtr: ViewSettings;
    private exprRef = React.createRef<any>();
    private sizeRef = React.createRef<any>();
    private displayNameRef = React.createRef<any>();
    private popupRef = React.createRef<HTMLDivElement>();
    private endian: string;
    private format: string;
    private column: string;

    constructor(props: IViewSettingsProps) {
        super(props);
        this.state = {
            settings: this.props.settings,
            isOpen: false,
            clientX: 0,
            clientY: 0
        };
        this.endian = props.settings.endian;
        this.format = props.settings.format;
        this.column = props.settings.column;
        ViewSettings.GlobalPtr = this;
    }

    static open(event: any, settings: IModifiableProps) {
        event.preventDefault();
        this.GlobalPtr.setState({
            settings: settings,
            clientX: event.clientX,
            clientY: event.clientY,
            isOpen: true
        });
        this.GlobalPtr.endian = settings.endian;
        this.GlobalPtr.format = settings.format;
        this.GlobalPtr.column = settings.column;
    }

    private onClickCloseFunc = this.onClickClose.bind(this);
    private onClickClose(event: any) {
        event && event.preventDefault();
        this.setState({
            isOpen: false
        });
        this.props.onDone(undefined);
    }

    private onClickOkayFunc = this.onClickOkay.bind(this);
    private onClickOkay(event: any) {
        event && event.preventDefault();
        this.setState({
            isOpen: false
        });

        const ret = { ...this.state.settings };
        let changed = false;
        if (ret.expr !== this.exprRef.current.value.trim()) {
            ret.expr = this.exprRef.current.value.trim();
            changed = true;
        }
        if (ret.size !== this.sizeRef.current.value.trim()) {
            ret.size = this.sizeRef.current.value.trim();
            changed = true;
        }
        if (ret.displayName !== this.displayNameRef.current.value.trim()) {
            ret.displayName = this.displayNameRef.current.value.trim();
            changed = true;
        }

        if (ret.endian !== this.endian) {
            ret.endian = this.endian as EndianType;
            changed = true;
        }

        if (ret.format !== this.format) {
            ret.format = this.format as RowFormatType;
            changed = true;
        }

        if (ret.column !== this.column) {
            ret.column = this.column;
            changed = true;
        }

        this.props.onDone(changed ? ret : undefined);
    }

    private onEndiannessChangeFunc = this.onEndiannessChange.bind(this);
    private onEndiannessChange(e: any) {
        this.endian = e.target.value;
    }

    private onFormatChangeFunc = this.onFormatChange.bind(this);
    private onFormatChange(e: any) {
        this.format = e.target.value;
    }

    private onColumnsChangeFunc = this.onColumnsChange.bind(this);
    private onColumnsChange(e: any) {
        const value = Number(e.target.value);
        if (value !== undefined && isNaN(value) === false && value !== 0) {
            this.column = e.target.value;
        }
    }

    private onKeyDownFunc = this.onKeyDown.bind(this);
    private onKeyDown(event: any) {
        if (event.key === 'Enter') {
            this.onClickOkayFunc(event);
        } else if (event.key === 'Escape') {
            this.onClickCloseFunc(event);
        }
    }

    componentDidUpdate() {
        if (this.state.isOpen && this.popupRef.current) {
            const width = this.popupRef.current.offsetWidth;
            if (width !== this.state.renderedWidth) {
                this.setState({ renderedWidth: width });
            }
        }
    }

    render(): React.ReactNode {
        let key = 0;
        const bigLabel = 'Address: Hex/decimal constant or expression';
        const estimatedWidth = 500;
        const width = this.state.renderedWidth || estimatedWidth;
        const left = Math.max(0, Math.min(this.state.clientX, window.innerWidth - width - 20));
        return (
            <div key={key++} style={{ display: +this.state.isOpen ? '' : 'none' }}>
                <div
                    key={key++}
                    className='popup'
                    id='view-settings'
                    ref={this.popupRef}
                    style={{
                        // top: this.state.clientY,
                        top: 0,
                        left: left
                    }}
                >
                    <VSCodeButton
                        key={key++}
                        appearance='icon'
                        style={{ float: 'right' }}
                        title='Close this memory view'
                        onClick={this.onClickCloseFunc}
                    >
                        <span className='codicon codicon-close'></span>
                    </VSCodeButton>
                    <VSCodeButton
                        key={key++}
                        appearance='icon'
                        style={{ float: 'right' }}
                        title='Save as Favorite'
                        onClick={() => {
                            const expr = this.exprRef.current.value.trim();
                            const size = this.sizeRef.current.value.trim();
                            const name = this.displayNameRef.current.value.trim();
                            DualViewDoc.addFavorite({ expr, size, name });
                        }}
                    >
                        <span className='codicon codicon-heart'></span>
                    </VSCodeButton>
                    <VSCodeTextField
                        key={key++}
                        autofocus
                        name='expr'
                        type='text'
                        style={{ width: '100%' }}
                        ref={this.exprRef}
                        value={this.state.settings.expr}
                    >
                        {bigLabel}
                    </VSCodeTextField>
                    <br key={key++}></br>
                    <VSCodeTextField
                        key={key++}
                        name='displayName'
                        type='text'
                        style={{ width: '100%' }}
                        ref={this.displayNameRef}
                        value={this.state.settings.displayName}
                    >
                        Display Name
                    </VSCodeTextField>
                    <br key={key++}></br>
                    <div key={key++} className='dialog-row'>
                        <div key={key++} className='dropdown-label-div'>
                            <label key={key++} className='dropdown-label'>
                                Format
                            </label>
                            <VSCodeDropdown key={key++} value={this.format} onChange={this.onFormatChangeFunc}>
                                <VSCodeOption key={key++} value='1-byte'>
                                    1-Byte
                                </VSCodeOption>
                                <VSCodeOption key={key++} value='2-byte'>
                                    2-Byte
                                </VSCodeOption>
                                <VSCodeOption key={key++} value='4-byte'>
                                    4-Byte
                                </VSCodeOption>
                                <VSCodeOption key={key++} value='8-byte'>
                                    8-Byte
                                </VSCodeOption>
                            </VSCodeDropdown>
                        </div>
                        <div key={key++} className='dropdown-label-div'>
                            <label key={key++} className='dropdown-label'>
                                Endianness
                            </label>
                            <VSCodeDropdown key={key++} value={this.endian} onChange={this.onEndiannessChangeFunc}>
                                <VSCodeOption key={key++} value='little'>
                                    Little
                                </VSCodeOption>
                                <VSCodeOption key={key++} value='big'>
                                    Big
                                </VSCodeOption>
                            </VSCodeDropdown>
                        </div>
                        <div key={key++} className='dropdown-label-div'>
                            <label key={key++} className='dropdown-label'>
                                &nbsp;#Columns
                            </label>
                            <VSCodeTextField
                                key={key++}
                                name='column'
                                type='text'
                                value={this.column}
                                onChange={this.onColumnsChangeFunc}
                            ></VSCodeTextField>
                        </div>
                    </div>
                    <div key={key++} className='dropdown-label-div' style={{ width: '100%' }}>
                        <label key={key++} className='dropdown-label'>
                            Memory Size
                        </label>
                        <VSCodeTextField
                            key={key++}
                            name='size'
                            type='text'
                            style={{ width: '78%' }}
                            ref={this.sizeRef}
                            value={this.state.settings.size}
                        ></VSCodeTextField>
                    </div>
                    <br key={key++}></br>
                    <div key={key++} style={{ marginTop: '10px' }}>
                        <VSCodeDropdown key={key++} style={{ width: '25ch' }}>
                            <VSCodeOption key={key++} value='view'>
                                Apply To: This View
                            </VSCodeOption>
                            <VSCodeOption key={key++} value='all-views' disabled>
                                Apply To: All Views
                            </VSCodeOption>
                            <VSCodeOption key={key++} value='all-views' disabled>
                                Apply To: Workspace Settings
                            </VSCodeOption>
                            <VSCodeOption key={key++} value='all-views' disabled>
                                Apply To: User Settings
                            </VSCodeOption>
                        </VSCodeDropdown>
                        <VSCodeButton
                            key={key++}
                            appearance='primary'
                            style={{ float: 'right', paddingRight: '1ch' }}
                            onClick={this.onClickOkayFunc}
                        >
                            Ok
                        </VSCodeButton>
                        <VSCodeButton
                            key={key++}
                            appearance='secondary'
                            style={{ float: 'right', marginRight: '10px' }}
                            onClick={this.onClickCloseFunc}
                        >
                            Cancel
                        </VSCodeButton>
                    </div>
                </div>
                <div className='popup-background' onClick={this.onClickCloseFunc}></div>
            </div>
        );
    }
}

interface IAddPopupViewProps {
    onDone: (info: IAddMemoryInfo | undefined) => void;
}

interface IAddPopupViewState {
    isOpen: boolean;
    clientX: number;
    clientY: number;
    renderedWidth?: number;
}
export class AddPopupView extends React.Component<IAddPopupViewProps, IAddPopupViewState> {
    static GlobalPtr: AddPopupView;
    private exprRef = React.createRef<any>();
    private sizeRef = React.createRef<any>();
    private popupRef = React.createRef<HTMLDivElement>();

    constructor(props: IAddPopupViewProps) {
        super(props);
        this.state = {
            isOpen: false,
            clientX: 0,
            clientY: 0
        };
        AddPopupView.GlobalPtr = this;
    }

    static open(event: any) {
        event.preventDefault();
        this.GlobalPtr.setState({
            isOpen: true,
            clientX: event.clientX,
            clientY: event.clientY
        });
    }

    private onClickCloseFunc = this.onClickClose.bind(this);
    private onClickClose(event: any) {
        event && event.preventDefault();
        this.setState({
            isOpen: false
        });
        this.props.onDone(undefined);
    }

    private onClickOkayFunc = this.onClickOkay.bind(this);
    private onClickOkay(event: any) {
        event && event.preventDefault();
        this.setState({
            isOpen: false
        });

        const expr = this.exprRef.current.value.trim();
        const size = this.sizeRef.current.value.trim();

        if (expr && size) {
            const ret: IAddMemoryInfo = { expr: expr, size: size };
            this.props.onDone(ret);
        } else {
            this.props.onDone(undefined);
        }
    }

    private onKeyDownFunc = this.onKeyDown.bind(this);
    private onKeyDown(event: any) {
        if (event.key === 'Enter') {
            this.onClickOkayFunc(event);
        } else if (event.key === 'Escape') {
            this.onClickCloseFunc(event);
        }
    }

    componentDidUpdate() {
        if (this.state.isOpen && this.popupRef.current) {
            const width = this.popupRef.current.offsetWidth;
            if (width !== this.state.renderedWidth) {
                this.setState({ renderedWidth: width });
            }
        }
    }

    render(): React.ReactNode {
        let key = 0;
        const bigLabel = 'Address: Hex/decimal constant or expression';
        const widthCh = 40;
        const estimatedWidth = widthCh * 10;
        const width = this.state.renderedWidth || estimatedWidth;
        const left = Math.max(0, Math.min(this.state.clientX, window.innerWidth - width - 20));
        return (
            <div key={key++} style={{ display: +this.state.isOpen ? '' : 'none' }}>
                <div
                    key={key++}
                    className='popup'
                    id='add-popup-view'
                    ref={this.popupRef}
                    style={{
                        width: `${bigLabel.length + 5}ch`,
                        top: 0,
                        left: left
                    }}
                >
                    <VSCodeButton
                        key={key++}
                        appearance='icon'
                        style={{ float: 'right' }}
                        title='Close this add view'
                        onClick={this.onClickCloseFunc}
                    >
                        <span className='codicon codicon-close'></span>
                    </VSCodeButton>
                    <VSCodeTextField
                        key={key++}
                        autofocus={true}
                        name='expr'
                        type='text'
                        style={{ width: '100%' }}
                        ref={this.exprRef}
                        onKeyDown={this.onKeyDownFunc}
                    >
                        {bigLabel}
                    </VSCodeTextField>
                    <br key={key++}></br>
                    <VSCodeTextField
                        key={key++}
                        name='size'
                        type='text'
                        style={{ width: '100%' }}
                        ref={this.sizeRef}
                        value='4 * 1024 * 1024'
                        onKeyDown={this.onKeyDownFunc}
                    >
                        Size: Hex/decimal constant or expression
                    </VSCodeTextField>
                    <br key={key++}></br>
                    <div key={key++} style={{ marginTop: '10px' }}>
                        <VSCodeButton
                            key={key++}
                            appearance='primary'
                            style={{ float: 'right', paddingRight: '1ch' }}
                            onClick={this.onClickOkayFunc}
                        >
                            Ok
                        </VSCodeButton>
                        <VSCodeButton
                            key={key++}
                            appearance='secondary'
                            style={{ float: 'right', marginRight: '10px' }}
                            onClick={this.onClickCloseFunc}
                        >
                            Cancel
                        </VSCodeButton>
                    </div>
                </div>
                <div className='popup-background' onClick={this.onClickCloseFunc}></div>
            </div>
        );
    }
}