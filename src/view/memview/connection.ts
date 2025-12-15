import { ICmdBase } from './shared';

export interface IVsCodeApi {
    postMessage(msg: unknown): void;
    getState(): any;
    setState(value: any): void;
}

export let vscodeApi: IVsCodeApi | undefined;

export function setVsCodeApi(api: IVsCodeApi) {
    vscodeApi = api;
}

export function isInWebview(): boolean {
    return !!vscodeApi;
}

interface MsgResponse {
    request: ICmdBase;
    resolve: (value: any) => void;
}

const pendingRequests: { [id: number]: MsgResponse } = {};
let seqNumber = 0;

function getSeqNumber(): number {
    if (seqNumber > (1 << 30)) {
        seqNumber = 0;
    }
    return ++seqNumber;
}

export function vscodePostCommand(msg: ICmdBase): Promise<any> {
    return new Promise((resolve) => {
        msg.seq = getSeqNumber();
        pendingRequests[seqNumber] = { request: msg, resolve: resolve };
        vscodeApi?.postMessage({ type: 'command', body: msg });
    });
}

export function vscodePostCommandNoResponse(msg: ICmdBase) {
    msg.seq = getSeqNumber();
    vscodeApi?.postMessage({ type: 'command', body: msg });
}

export function getPendingRequest(seq: number): MsgResponse | undefined {
    return pendingRequests[seq];
}

export function removePendingRequest(seq: number) {
    delete pendingRequests[seq];
}
