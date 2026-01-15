import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { globalsInit, myGlobals, vscodePostCommand, documentManager } from './webview-globals';
import * as Utils from './utils';
import { RecoilRoot } from 'recoil';
import './index.css';
// import { HexTableVirtual } from './hex-table-virtual';
import { HexTableVirtual2 } from './hex-table-virtual2';
import { MemViewToolbar } from './top-panel';
import {
    ICmdGetMemory,
    ICmdGetStartAddress,
    IMemoryInterfaceCommands,
    CmdType,
    ICmdBase,
    ICmdSetMemory,
    ICmdGetMaxBytes,
    ICmdSetExpr
} from './shared';
import {
    provideVSCodeDesignSystem,
    vsCodeButton,
    vsCodeDivider,
    vsCodeDropdown,
    vsCodeOption,
    vsCodeTextField
} from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(
    vsCodeButton(),
    vsCodeDivider(),
    vsCodeDropdown(),
    vsCodeOption(),
    vsCodeTextField()
);


class MemoryInterfaceFromVSCode implements IMemoryInterfaceCommands {
    getStartAddress(arg: ICmdGetStartAddress): Promise<string> {
        return vscodePostCommand(arg);
    }
    getMaxBytes(arg: ICmdGetMaxBytes): Promise<string> {
        return vscodePostCommand(arg);
    }
    getMemory(arg: ICmdGetMemory): Promise<Uint8Array> {
        return vscodePostCommand(arg);
    }
    setMemory(arg: ICmdSetMemory): Promise<boolean> {
        return vscodePostCommand(arg);
    }
    setExpr(arg: ICmdSetExpr): Promise<string> {
        return vscodePostCommand(arg);
    }
}

const timer = new Utils.Timekeeper();
// console.log('initializing webview');

function doStartup() {
    globalsInit();
    documentManager.init(new MemoryInterfaceFromVSCode());

    // When the tab becomes visible again (user clicks on it), we need to check if we missed any
    // events while we were hidden. The extension may have sent us messages but if we were
    // suspended, we might have dropped them.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            const msg: ICmdBase = {
                type: CmdType.GetDebuggerSessions,
                seq: 0,
                sessionId: '',
                docId: ''
            };
            vscodePostCommand(msg);
        }
    });

    const promises = [];
    const msg: ICmdBase = {
        type: CmdType.GetDocuments,
        seq: 0,
        sessionId: '',
        docId: ''
    };
    promises.push(vscodePostCommand(msg));
    msg.type = CmdType.GetDebuggerSessions;
    promises.push(vscodePostCommand(msg));

    Promise.all(promises)
        .catch((e) => {
            console.error('Failed to do startup sequence', e);
        })
        .finally(() => {
            startRender();
        });
}

function startRender() {
    ReactDOM.render(
        <RecoilRoot>
            <MemViewToolbar junk='abcd'></MemViewToolbar>
            <HexTableVirtual2 />
        </RecoilRoot>,
        document.getElementById('root')
    );

    myGlobals.vscode?.postMessage({ type: 'started' });
    false && console.log(`HexTable:render ${timer.deltaMs()}ms`);
}

doStartup();
