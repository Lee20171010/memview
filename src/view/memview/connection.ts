
export interface IVsCodeApi {
    postMessage(msg: unknown): void;
    getState(): any;
    setState(value: any): void;
}

export let vscodeApi: IVsCodeApi | undefined;

export function setVsCodeApi(api: IVsCodeApi) {
    vscodeApi = api;
}

export function vscodePostCommandNoResponse(msg: unknown) {
    vscodeApi?.postMessage(msg);
}

export function isInWebview(): boolean {
    return !!vscodeApi;
}
