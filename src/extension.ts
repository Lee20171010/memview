
import * as vscode from 'vscode';
// import * as path from 'path';
import { DebugTrackerFactory } from './view/memview/debug-tracker';
import { /*MemviewDocumentProvider, */ MemViewPanelProvider } from './view/memview/memview-doc';


class MemView {
    static Extension: MemView;
    private toggleMemoryView() {
        const config = vscode.workspace.getConfiguration('memview', null);
        const isEnabled = !config.get('showMemoryPanel', false);
        const panelLocation = config.get('memoryViewLocation', 'panel');
        config.update('showMemoryPanel', isEnabled);
        const status = isEnabled ? `visible in the '${panelLocation}' area` : 'hidden';
        vscode.window.showInformationMessage(`Memory views are now ${status}`);
    }

    private onSettingsChanged(_e: vscode.ConfigurationChangeEvent) {
        this.setContexts();
    }

    private setContexts() {
        const config = vscode.workspace.getConfiguration('memview', null);
        const isEnabled = config.get('showMemoryPanel', false);
        const panelLocation = config.get('memoryViewLocation', 'panel');
        vscode.commands.executeCommand('setContext', 'memview:showMemoryPanel', isEnabled);
        vscode.commands.executeCommand('setContext', 'memview:memoryPanelLocation', panelLocation);
    }

    onDeactivate() {
        MemViewPanelProvider.saveState();
    }

    constructor(public context: vscode.ExtensionContext) {
        MemView.Extension = this;
        try {
            DebugTrackerFactory.register(context);
            // MemviewDocumentProvider.register(context);
            MemViewPanelProvider.register(context);
            // const p = path.join(context.extensionPath, 'package.json');
            // MemViewPanelProvider.doTest(p);
        }
        catch (e) {
            console.log('Memview extension could not start', e);
        }

        this.setContexts();

        context.subscriptions.push(
            vscode.commands.registerCommand('memview.toggleMemoryView', this.toggleMemoryView.bind(this)),
            vscode.commands.registerCommand('memview.hello', () => {
                vscode.window.showInformationMessage('Hello from memview extension');
            }),
            vscode.commands.registerCommand('memview.addMemoryView', MemViewPanelProvider.newMemoryView),
            vscode.workspace.onDidChangeConfiguration(this.onSettingsChanged.bind(this))
        );
    }
}

export function activate(context: vscode.ExtensionContext) {
    new MemView(context);
}

// this method is called when your extension is deactivated
export function deactivate() {
    MemView.Extension.onDeactivate();
    console.log('Deactivating memview');
}
