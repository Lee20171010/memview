declare function acquireVsCodeApi(): IVsCodeApi;

declare global {
    interface Window {
        initialDataFromVSCode: string;
        viewType: string;
    }
}

export function globalsInit() {
    window.addEventListener('message', vscodeReceiveMessage);
    myGlobals.vscode = acquireVsCodeApi();
    if (myGlobals.vscode) {
        setVsCodeApi(myGlobals.vscode);
    }
    myGlobals.selContext = new SelContext();
    myGlobals.viewType = window.viewType;

    addMessageHandler(CmdType.SetDocuments, (body) => {
        documentManager.restoreSerializableAll(body);
        // We also need to emit an event to ensure UI updates if restoreSerializableAll didn't emit enough
        // But restoreSerializableAll calls updateFromSerializable which emits CurrentDoc event.
        // We might want to emit 'Refresh' or similar if needed.
        // For now, let's assume updateFromSerializable is enough.
        documentManager.globalEventEmitter.emit('any', {});
    });
}

import {
    atom,
    RecoilState,
} from 'recoil';
import { setVsCodeApi, vscodePostCommand, vscodePostCommandNoResponse, getPendingRequest, removePendingRequest } from './connection';
import { DualViewDocGlobalEventType, IDualViewDocGlobalEventArg, DocumentManager } from './dual-view-doc';
import { MsgResponse, ICmdBase, IMessage, CmdType } from './shared';
import { WebviewDebugTracker } from './webview-debug-tracker';
import { SelContext } from './selection';

export interface IVsCodeApi {
    postMessage(msg: unknown): void;
    getState(): any;
    setState(value: any): void;
}

export interface IMyGlobals {
    vscode?: IVsCodeApi;
    selContext?: SelContext;
    viewType?: string;
}

export const myGlobals: IMyGlobals = {
};

export const documentManager = new DocumentManager();

export const frozenState: RecoilState<boolean> = atom({
    key: 'frozenState', // unique ID (with respect to other atoms/selectors)
    default: false,      // default value (aka initial value)
});

export function vscodeGetState<T>(item: string): T | undefined {
    const state = myGlobals.vscode?.getState();
    if (state) {
        return state[item] as T;
    }
    return undefined;
}

export function vscodeSetState<T>(item: string, v: T): void {
    const state = { ...myGlobals.vscode?.getState() };
    state[item] = v;
    myGlobals.vscode?.setState(state);
}

type CommandHandler = (event: any) => void;
const commandHanders: { [command: string]: CommandHandler[] } = {};

export { vscodePostCommand, vscodePostCommandNoResponse };

function vscodeReceiveMessage(event: any) {
    const data = event.data as IMessage;
    if (data.type === 'response') {
        recieveResponseFromVSCode(data);
    } else if (data.type === 'command') {
        if (typeof data.command === 'string') {
            const handlers = commandHanders[data.command];
            if (handlers) {
                for (let ix = 0; ix < handlers.length; ix++) {
                    handlers[ix](data.body);
                }
            } else {
                console.error(`No hanlders for command ${data.command}`, data);
            }
        } else {
            console.error(`unrecognized command ${data.command} for command`, data);
        }
    } else if (data.type === 'notice') {
        recieveNoticeFromVSCode(data);
    } else {
        console.error('unrecognized event type for "message" from vscode', data);
    }
}

function recieveResponseFromVSCode(response: IMessage) {
    const seq = response.seq;
    const pending = getPendingRequest(seq);
    if (pending && pending.resolve) {
        switch (response.command) {
            // Some commands don't need any translation. Only deal with
            // those that need it
            case CmdType.GetDocuments: {
                documentManager.restoreSerializableAll(response.body);
                pending.resolve(true);
                break;
            }
            case CmdType.GetDebuggerSessions: {
                WebviewDebugTracker.updateSessions(response.body);
                pending.resolve(true);
                break;
            }
            case CmdType.GetFavoriteInfo: {
                if (documentManager) {
                    documentManager.favoriteInfoAry = response.body;
                }
                pending.resolve(true);
                break;
            }
            default: {
                pending.resolve(response.body);
                break;
            }
        }
        } else {
        console.error(`No pending response for comand with id ${seq}`, response);
    }
    removePendingRequest(seq);
}

function recieveNoticeFromVSCode(notice: IMessage) {
    switch (notice.command) {
        case CmdType.DebugerStatus: {
            WebviewDebugTracker.updateSession(notice.body);
            break;
        }
        case CmdType.ScrollToBottom: {
            const arg: IDualViewDocGlobalEventArg = {
                type: DualViewDocGlobalEventType.ScrollToBottom,
                docId: notice.body.docId,
                baseAddress: 0n, // Not used
                maxBytes: 0n // Not used
            };
            documentManager.globalEventEmitter.emit(DualViewDocGlobalEventType.ScrollToBottom, arg);
            break;
        }
        default: {
            console.error('Invalid notice', notice);
            break;
        }
    }
}

export function addMessageHandler(type: string, handler: CommandHandler) {
    const existing = commandHanders[type];
    if (!existing) {
        commandHanders[type] = [handler];
    } else {
        removeMessageHandler(type, handler);        // Remove if already in the list
        existing.push(handler);                     // Now add at the end
    }
}

export function removeMessageHandler(type: string, handler: CommandHandler) {
    const existing = commandHanders[type];
    if (existing) {
        const ix = existing.indexOf(handler);
        if (ix >= 0) {
            existing.splice(ix, 1);
        }
    }
}
