# Multiple Memory View Panels Design

## 1. Architecture Overview

To support multiple independent memory view panels (e.g., for side-by-side comparison), we will register multiple Webview Views in VS Code. Each view will be handled by a separate instance (or a managed instance) of the `MemViewPanelProvider`.

### 1.1 View Registration (`package.json`)

We will pre-register 6 views. This is a static requirement of VS Code extensions.

*   **View Container**: All views will reside in the same `viewsContainer` (id: `memory-view`). This allows them to be grouped together in the UI, but the user can drag them to different locations (side-by-side, stacked, etc.).
*   **Views**:
    *   `memory-view.memoryView` (Main "MEMORY" panel) - Controlled by `memory-view:showMemoryPanel`
    *   `memory-view.memoryView1` (MEMORY1) - Controlled by `memory-view:showPanel1`
    *   `memory-view.memoryView2` (MEMORY2) - Controlled by `memory-view:showPanel2`
    *   `memory-view.memoryView3` (MEMORY3) - Controlled by `memory-view:showPanel3`
    *   `memory-view.memoryView4` (MEMORY4) - Controlled by `memory-view:showPanel4`
    *   `memory-view.memoryView5` (MEMORY5) - Controlled by `memory-view:showPanel5`

### 1.2 Provider Management (`MemViewPanelProvider`)

Currently, `MemViewPanelProvider` is a singleton (`MemViewPanelProvider.Provider`). We need to refactor this to support multiple instances.

*   **Factory/Manager**: A `MemViewPanelManager` class will be responsible for creating and registering providers for each of the 6 view IDs.
*   **Instance Independence**: Each `MemViewPanelProvider` instance will manage its own `webviewView` and its own set of documents (`DualViewDoc` list).
    *   **Refactoring**: `DualViewDoc` currently relies on static members (`allDocuments`, `currentDoc`). This must be refactored. We will likely introduce a `DocumentContext` or `SessionContext` that is passed to `DualViewDoc` instances, or make `DualViewDoc` purely a data class managed by the Provider.
    *   **Decision**: Each Panel will have its own `DocumentManager` instance. The `DualViewDoc` class will be updated to not rely on global statics for document lookup.

## 2. User Interface & UX

### 2.1 Opening New Panels ("+")

*   **Location**: In the Webview Toolbar, aligned to the right, next to the existing "Close Document" button.
*   **Mechanism**:
    *   Button: `+` icon (codicon-add).
    *   Action: Sends a command to the extension.
    *   Extension Logic: Finds the first *disabled* panel (e.g., MEMORY1 where `isEnabled` is false).
    *   Extension Action: Sets `memory-view:showPanel1` to `true` (making it visible) and focuses it.
    *   **Error Handling**: If all 6 panels are already visible:
        *   Show a warning message: "Max number of memory panels reached."
        *   Do not open any new panel.

### 2.2 Closing Panels ("X")

*   **Location**: In the Webview Toolbar, aligned to the right, next to the "+" button.
*   **Visibility**:
    *   **Main Panel (MEMORY)**: Hidden. The main panel is controlled via the global toggle command or settings.
    *   **Secondary Panels (MEMORY1-5)**: Visible.
*   **Mechanism**:
    *   Button: `X` icon (codicon-close).
    *   Action: Sends a command to the extension.
    *   Extension Logic:
        1.  Sets the corresponding context key (e.g., `memory-view:showPanel1`) to `false`.
        2.  Sets the provider's `isEnabled` state to `false`.
        3.  **Note**: This effectively hides the panel from the UI but **does not clear the documents**. This allows the state (documents) to be preserved if the user re-opens the panel later. This behavior is consistent with how the Main Panel's toggle works.

### 2.3 Adding Memory Views (Commands)

*   **`mcu-debug.memory-view.addMemoryView`**:
    *   This command (and the "Add Memory" button in Hex Editor) will **always target the Main Panel (MEMORY)**.
    *   This avoids ambiguity.
    *   To add memory to a secondary panel, the user must use the "+" button *inside* that specific panel's toolbar (if we implement a local "Add Memory" button there) or just use the main panel and drag the tab (if VS Code supported dragging webview tabs between panels, which it doesn't quite do for Custom Views in the same way).
    *   *Correction*: Each panel has its own "Add new memory view" button (the `+` on the left side of the toolbar). That button will continue to work for *that specific panel*. The *Global Command* will target the Main Panel.

### 2.4 Toggle Command

*   **`mcu-debug.memory-view.toggleMemoryView`**:
    *   Will only toggle the visibility of the **Main Panel (MEMORY)**.
    *   Secondary panels are managed manually by the user via the UI buttons.

### 2.5 Additional Error Handling & Edge Cases

*   **State Restoration on Reload**:
    *   VS Code restores webviews on window reload.
    *   **Risk**: If the saved state (in `workspaceState`) is corrupt or mismatched.
    *   **Handling**: Wrap state restoration for *each* panel in a try-catch block. If Panel 1's state is corrupt, log an error and initialize it as empty, but allow Panel 2 to restore correctly.

*   **"Add Memory" Command & Visibility**:
    *   **Scenario**: User runs "Add Memory View" command, but the Main Panel is currently hidden (toggled off).
    *   **Handling**: The command must explicitly check the Main Panel's visibility context. If false, set it to true (reveal the panel) *before* adding the memory view.

*   **Resource Cleanup (Memory Leaks)**:
    *   **Scenario**: User "closes" a panel via the "X" button.
    *   **Handling**:
        *   We must explicitly `dispose()` all `DualViewDoc` instances associated with that panel.
        *   **Crucial**: Ensure all event listeners (e.g., `DebuggerTracker` subscriptions) attached to those documents are unsubscribed. Failure to do so will cause memory leaks and potential errors (callbacks trying to update destroyed webviews).

*   **Settings Synchronization**:
    *   **Note**: View-specific settings (like Row Height, Column Width calculated from auto-size) are currently stored in Webview State (`vscode.setState`).
    *   **Behavior**: These will be **per-panel**. Changing row height in Panel 1 will not affect Panel 2. This is likely acceptable/desired for independent views, but worth noting.

*   **Manual Hiding vs. Context Keys**:
    *   **Scenario**: User right-clicks the panel in the sidebar and selects "Hide". The extension's context key (`memory-view:showPanel1`) remains `true`.
    *   **Handling**: When the user clicks "+" again, the extension might see `showPanel1` is true and skip it.
    *   **Fix**: The "+" logic should try to `focus()` the panel even if the context key is true. `focus()` usually re-opens the view if it was manually hidden. If the user wants to "open a new one", they might be confused if it jumps to an existing one, but since we only have 6 slots, jumping to an existing (but hidden) slot is the correct behavior.

## 3. Implementation Details

### 3.1 `DualViewDoc` Refactoring

*   **Current**: `static allDocuments`, `static currentDoc`.
*   **Required**: Instance-based state.
    *   Create a `DocumentManager` class.
    *   Each `MemViewPanelProvider` owns a `DocumentManager`.
    *   `DualViewDoc` logic moves to use the `DocumentManager` passed to it or associated with it.

### 3.2 `MemViewPanelProvider` Changes

*   Constructor takes a `viewType` (e.g., `memory-view.memoryView1`).
*   `resolveWebviewView` stores the `webviewView` instance.
*   `handleMessage` handles messages specific to that panel.
*   **Management**: `MemViewPanelProvider` maintains a static list `Providers` of all registered instances.

### 3.3 Communication

*   The extension routes messages (like "Debugger Status Changed") to **all** active panels so they can update their status.
*   `DebuggerTracker` events are broadcast to all provider instances via event listeners.

## 4. Implementation Status

1.  **Refactor `DualViewDoc`**: **Completed**. Static dependency removed. `DocumentManager` introduced.
2.  **Update `package.json`**: **Completed**. 5 new views added.
3.  **Update `MemViewPanelProvider`**: **Completed**. Supports multiple instances and registers all 6 views.
4.  **Update UI (React)**: **Completed**. "+" and "X" buttons added to toolbar.
5.  **Implement Logic**: **Completed**. "+" finds next available view, "X" hides the panel.

## 5. Shared State & Isolation Analysis

### 5.1 Communication Channel (Safe)

*   **Frontend to Backend**: Each Webview posts messages to the Extension Host. The message contains the command.
*   **Backend to Frontend**:
    *   **Current**: `MemViewPanelProvider` is a singleton.
    *   **Fix**: We will instantiate a `MemViewPanelProvider` **per panel**.
    *   Each provider instance holds its own `this.webviewView`.
    *   When sending a response (`postResponse`), it uses its specific `webviewView` instance.
    *   **Result**: Messages are strictly isolated. Panel 1's provider only talks to Panel 1's Webview.

### 5.2 Backend Shared State (Critical Issues)

The `DualViewDoc` class is defined in `dual-view-doc.tsx` and is used by **both** the Frontend (Webview) and Backend (Extension Host).

*   **Frontend (Webview)**: Safe. Each Webview runs in a separate process/context. Static variables in `DualViewDoc` are isolated per Webview.
*   **Backend (Extension Host)**: **Unsafe**. All panels run in the *same* Extension Host process. Static variables are shared across all panels.

#### Identified Shared State Issues:

1.  **`DualViewDoc.currentDoc` (Static)**
    *   **Problem**: If Panel 1 sets this to Doc A, and Panel 2 sets it to Doc B, they overwrite each other. Functions like `dumpBin` currently rely on this global.
    *   **Solution**: Remove all dependencies on `DualViewDoc.currentDoc` in the backend. Pass `docId` or the `DualViewDoc` instance explicitly to all helper functions.

2.  **`DualViewDoc.allDocuments` (Static Map)**
    *   **Problem**: This map holds *all* documents from *all* panels.
    *   **Consequence**: When Panel 1 requests the list of documents (for its dropdown), it will receive documents from Panel 2 as well. This violates the "Independent Panels" requirement.
    *   **Solution**:
        *   Refactor `DualViewDoc` to remove static document management.
        *   Create a `DocumentManager` class.
        *   Each `MemViewPanelProvider` instance owns its own `DocumentManager`.
        *   The `DocumentManager` holds the `allDocuments` map for that specific panel.

3.  **Persistence (`saveState` / `restoreState`)**
    *   **Problem**: Currently uses a single key `documents` in `workspaceState` to save all docs.
    *   **Consequence**: On reload, we won't know which document belongs to which panel.
    *   **Solution**:
        *   Change the save structure to be hierarchical: `{ "memory-view": [...], "memory-view1": [...], ... }`.
        *   Or use separate keys: `documents_main`, `documents_1`, etc.

4.  **`DebuggerTracker` (Singleton)**
    *   **Status**: **Safe/Desired**.
    *   Debug sessions are global to VS Code. All panels should see the same list of debug sessions.
    *   The event emitter should broadcast to all Provider instances so they can all update their respective UIs.

### 5.3 Refactoring Status

1.  **Step 1**: Refactor `DualViewDoc` (Backend usage) to stop using statics. Introduce `DocumentManager`. **(Done)**
2.  **Step 2**: Update `MemViewPanelProvider` to be instantiable and own a `DocumentManager`. **(Done)**
3.  **Step 3**: Implement `MemViewPanelManager` (via static `Providers` list) to manage the 6 provider instances. **(Done)**
4.  **Step 4**: Update `package.json` and UI. **(Done)**

### 5.4 Additional Shared State Review

*   **`DebuggerTrackerLocal` (Backend)**:
    *   **Status**: **Safe**. Debug sessions are global to VS Code. All panels should see the same list of debug sessions.
    *   **Action**: Ensure event emitters broadcast to all Provider instances. **(Done: Each provider subscribes independently)**

*   **`SelContext` / `webview-globals` (Frontend)**:
    *   **Status**: **Safe**. These run inside the Webview process. Since each Panel is a separate Webview (iframe), their states are naturally isolated.

*   **`MemViewExtension` (Backend)**:
    *   **Status**: **Updated**.
    *   `toggleMemoryView` currently only toggles the main panel.
    *   `setContexts` initializes the visibility contexts for the new panels (`memory-view:showPanel1`...`5`) to `false` by default.

*   **`MemViewPanelProvider.register`**:
    *   **Status**: **Updated**. Registers all 6 views and populates the `Providers` list.

*   **`vscode.UriHandler`**:
    *   **Status**: **Resolved**. Only the Main Panel provider registers as the URI handler.

*   **Static Command Helpers (`addMemoryView`, `newMemoryView`)**:
    *   **Status**: **Updated**. These methods now use `MemViewPanelProvider.Providers[0]` to target the Main Panel.

*   **`DualViewDoc.globalEventEmitter` (Backend)**:
    *   **Status**: **Resolved**. Moved into `DocumentManager`. Each panel has its own event bus for its documents.

