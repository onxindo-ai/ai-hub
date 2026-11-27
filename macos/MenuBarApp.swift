import Cocoa
import WebKit
import Carbon

// MARK: - Sleek Top-Edge Peek Strip (Visible when retracted at top edge)
final class EdgeTabView: NSView {
    var hasActiveJob: Bool = false {
        didSet { needsDisplay = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill()
        dirtyRect.fill()

        // Pill flush against top edge with rounded bottom corners
        let pillRect = NSRect(x: 8, y: 2, width: bounds.width - 16, height: bounds.height - 2)
        let path = NSBezierPath(roundedRect: pillRect, xRadius: 5, yRadius: 5)

        NSColor(calibratedRed: 0.98, green: 0.985, blue: 0.995, alpha: 0.96).setFill()
        path.fill()

        NSColor(calibratedRed: 0.15, green: 0.39, blue: 0.92, alpha: 0.28).setStroke()
        path.lineWidth = 1
        path.stroke()

        // Center indicator bar
        let barW: CGFloat = 36
        let barH: CGFloat = 3
        let barRect = NSRect(
            x: (bounds.width - barW) / 2.0,
            y: (pillRect.minY + pillRect.maxY - barH) / 2.0,
            width: barW,
            height: barH
        )
        let barPath = NSBezierPath(roundedRect: barRect, xRadius: 1.5, yRadius: 1.5)
        if hasActiveJob {
            NSColor(calibratedRed: 0.96, green: 0.62, blue: 0.04, alpha: 0.95).setFill()
        } else {
            NSColor(calibratedRed: 0.15, green: 0.39, blue: 0.92, alpha: 0.85).setFill()
        }
        barPath.fill()
    }
}

// MARK: - Top Native Drag Handle View (120fps native window drag + magnetic snap hint)
final class TitleDragView: NSView {
    var isDockedTop: Bool = true {
        didSet { needsDisplay = true }
    }
    var dragHint: String? = nil {
        didSet {
            if oldValue != dragHint { needsDisplay = true }
        }
    }
    var isSnapHighlight: Bool = false {
        didSet {
            if oldValue != isSnapHighlight { needsDisplay = true }
        }
    }
    var onStartDrag: ((NSEvent) -> Void)?

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        onStartDrag?(event)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        if isSnapHighlight {
            NSColor(calibratedRed: 0.91, green: 0.95, blue: 1.0, alpha: 1.0).setFill()
        } else {
            NSColor(calibratedRed: 0.965, green: 0.969, blue: 0.978, alpha: 1.0).setFill()
        }
        dirtyRect.fill()

        NSColor(calibratedWhite: 0.0, alpha: 0.06).setFill()
        NSRect(x: 0, y: 0, width: bounds.width, height: 1).fill()

        if let hint = dragHint {
            let color = isSnapHighlight
                ? NSColor(calibratedRed: 0.14, green: 0.39, blue: 0.92, alpha: 1.0)
                : NSColor(calibratedWhite: 0.35, alpha: 1.0)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
                .foregroundColor: color,
            ]
            let size = (hint as NSString).size(withAttributes: attrs)
            let pt = NSPoint(x: (bounds.width - size.width) / 2.0, y: (bounds.height - size.height) / 2.0)
            (hint as NSString).draw(at: pt, withAttributes: attrs)
            return
        }

        // Centered tactile drag pill
        let pillWidth: CGFloat = 38
        let pillHeight: CGFloat = 4.5
        let pillRect = NSRect(
            x: (bounds.width - pillWidth) / 2.0,
            y: (bounds.height - pillHeight) / 2.0,
            width: pillWidth,
            height: pillHeight
        )
        let path = NSBezierPath(roundedRect: pillRect, xRadius: 2.25, yRadius: 2.25)
        if isDockedTop {
            NSColor(calibratedRed: 0.15, green: 0.39, blue: 0.92, alpha: 0.35).setFill()
        } else {
            NSColor(calibratedWhite: 0.0, alpha: 0.18).setFill()
        }
        path.fill()
    }
}

// MARK: - First-Class Keyable Window
final class HubWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown {
            if !NSApp.isActive {
                NSApp.activate(ignoringOtherApps: true)
            }
            if !self.isKeyWindow {
                self.makeKey()
            }
        }
        super.sendEvent(event)
    }
}

// MARK: - WebView Container Controller
final class HubContentController: NSViewController, WKScriptMessageHandler {
    let dragBar = TitleDragView()
    private(set) var webView: WKWebView!
    var onAction: (([String: Any]) -> Void)?

    override func loadView() {
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 640))
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor(calibratedRed: 0.965, green: 0.969, blue: 0.978, alpha: 1.0).cgColor

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "macHost")
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.setValue(false, forKey: "drawsBackground")
        self.webView = wv

        dragBar.translatesAutoresizingMaskIntoConstraints = false
        wv.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(dragBar)
        root.addSubview(wv)

        NSLayoutConstraint.activate([
            dragBar.topAnchor.constraint(equalTo: root.topAnchor),
            dragBar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            dragBar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            dragBar.heightAnchor.constraint(equalToConstant: 28),

            wv.topAnchor.constraint(equalTo: dragBar.bottomAnchor),
            wv.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            wv.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])

        self.view = root
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let dict = message.body as? [String: Any] {
            onAction?(dict)
        }
    }
}

private var sharedAppDelegate: AppDelegate?

private func hotKeyCallback(nextHandler: EventHandlerCallRef?, theEvent: EventRef?, userData: UnsafeMutableRawPointer?) -> OSStatus {
    DispatchQueue.main.async {
        sharedAppDelegate?.togglePanelFromMenuOrHotKey()
    }
    return noErr
}

// MARK: - AppDelegate
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var statusItem: NSStatusItem!
    private var window: HubWindow!
    private var edgeWindow: NSWindow!
    private let edgeTabView = EdgeTabView(frame: NSRect(x: 0, y: 0, width: 140, height: 10))
    private let contentVC = HubContentController()
    private let contextMenu = NSMenu()
    private var nodeProcess: Process?
    private var stdinPipe: Pipe?
    private var serverPort: Int = 0
    private var hotKeyRef: EventHotKeyRef?

    // Docking & Auto-hide State
    private var isDockedTop: Bool = true
    private var isCollapsedToEdge: Bool = false
    private var isAlwaysOnTop: Bool = true
    private var isProgrammaticMove: Bool = false
    private var isUserDragging: Bool = false
    private var isAnimating: Bool = false
    private var dockedX: CGFloat? = nil
    private weak var dockedScreen: NSScreen? = nil

    private var hoverTimer: Timer?
    private var dragReleaseTimer: Timer?
    private var outsideTicks: Int = 0
    private var pauseAutoHideUntil: Date = .distantPast

    func applicationDidFinishLaunching(_ notification: Notification) {
        sharedAppDelegate = self
        NSApp.appearance = NSAppearance(named: .aqua)

        setupMainMenu()
        setupStatusItem()
        setupEdgeWindow()
        setupWindow()
        setupContextMenu()
        registerGlobalHotKey()
        startHoverWatcher()
        startLocalServer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        hoverTimer?.invalidate()
        dragReleaseTimer?.invalidate()
        if let pipe = stdinPipe {
            try? pipe.fileHandleForWriting.close()
        }
        if let proc = nodeProcess, proc.isRunning {
            proc.terminate()
        }
    }

    private func setupMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "隐藏多AI中枢", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "退出多AI中枢", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        NSApp.mainMenu = mainMenu
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        guard let button = statusItem.button else { return }
        updateStatusIcon(activeCount: 0)
        button.target = self
        button.action = #selector(handleStatusBarClick(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.toolTip = "多AI中枢 (⌃⌥J)"
    }

    private func updateStatusIcon(activeCount: Int) {
        edgeTabView.hasActiveJob = activeCount > 0
        guard let button = statusItem.button else { return }
        let symbolName = activeCount > 0 ? "bolt.horizontal.circle.fill" : "square.grid.2x2.fill"
        if let img = NSImage(systemSymbolName: symbolName, accessibilityDescription: "多AI中枢") {
            let cfg = NSImage.SymbolConfiguration(pointSize: 13.5, weight: .semibold)
            let configured = img.withSymbolConfiguration(cfg) ?? img
            configured.isTemplate = true
            button.image = configured
            button.imagePosition = activeCount > 0 ? .imageLeading : .imageOnly
        }
        button.title = activeCount > 0 ? " \(activeCount)" : ""
    }

    private func setupEdgeWindow() {
        edgeWindow = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 140, height: 10),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        edgeWindow.isOpaque = false
        edgeWindow.backgroundColor = .clear
        edgeWindow.hasShadow = true
        edgeWindow.level = .statusBar
        edgeWindow.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        edgeWindow.ignoresMouseEvents = false
        edgeWindow.contentView = edgeTabView

        let click = NSClickGestureRecognizer(target: self, action: #selector(handleEdgeTabClick))
        edgeTabView.addGestureRecognizer(click)
    }

    @objc private func handleEdgeTabClick() {
        expandFromTopEdge()
    }

    private func setupWindow() {
        let rect = NSRect(x: 0, y: 0, width: 420, height: 640)
        window = HubWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.appearance = NSAppearance(named: .aqua)
        window.backgroundColor = NSColor(calibratedRed: 0.965, green: 0.969, blue: 0.978, alpha: 1.0)
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = false
        window.isReleasedWhenClosed = false
        window.hasShadow = true
        window.minSize = NSSize(width: 360, height: 480)
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        window.contentViewController = contentVC
        window.delegate = self

        contentVC.dragBar.onStartDrag = { [weak self] event in
            self?.beginWindowDrag(with: event)
        }

        applyWindowModeUI()

        contentVC.onAction = { [weak self] payload in
            guard let self = self, let type = payload["type"] as? String else { return }
            switch type {
            case "quit":
                NSApp.terminate(nil)
            case "activateIDE":
                self.activateExistingAntigravity()
                if self.isDockedTop && !self.isCollapsedToEdge {
                    self.collapseToTopEdge()
                }
            case "dockTop":
                self.snapToTopEdgeAndDock()
            case "detachFree":
                self.detachIntoFreeWindow()
            case "togglePin":
                self.isAlwaysOnTop.toggle()
                self.applyWindowModeUI()
                self.syncWindowStateToWeb()
            case "pauseAutoHide":
                let ms = payload["ms"] as? Double ?? 2800
                self.pauseAutoHideUntil = Date().addingTimeInterval(ms / 1000.0)
            case "badge":
                let count = payload["activeCount"] as? Int ?? 0
                self.updateStatusIcon(activeCount: count)
            default:
                break
            }
        }
    }

    // MARK: - Dragging & Magnetic Top-Edge Snap
    private func beginWindowDrag(with event: NSEvent) {
        isUserDragging = true
        outsideTicks = 0
        pauseAutoHideUntil = Date().addingTimeInterval(1.2)
        edgeWindow.orderOut(nil)
        isCollapsedToEdge = false

        window.performDrag(with: event)

        dragReleaseTimer?.invalidate()
        dragReleaseTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] t in
            guard let self = self else { t.invalidate(); return }
            if (NSEvent.pressedMouseButtons & 1) == 0 {
                t.invalidate()
                self.finishWindowDrag()
            }
        }
    }

    func windowDidMove(_ notification: Notification) {
        guard isUserDragging, !isProgrammaticMove else { return }
        let screen = currentScreenForWindow()
        let vis = screen.visibleFrame
        let distFromTop = vis.maxY - window.frame.maxY

        if distFromTop <= 26 {
            contentVC.dragBar.isSnapHighlight = true
            contentVC.dragBar.dragHint = "🧲 松手吸附顶部 · 鼠标移走自动收起"
        } else {
            contentVC.dragBar.isSnapHighlight = false
            contentVC.dragBar.dragHint = "❐ 松手停放为独立窗口"
            if isDockedTop {
                isDockedTop = false
                applyWindowModeUI()
                syncWindowStateToWeb()
            }
        }
    }

    private func finishWindowDrag() {
        isUserDragging = false
        contentVC.dragBar.isSnapHighlight = false
        contentVC.dragBar.dragHint = nil

        let screen = currentScreenForWindow()
        let vis = screen.visibleFrame
        let distFromTop = vis.maxY - window.frame.maxY

        if distFromTop <= 26 {
            // Snap magnetically flush to top edge!
            let clampedX = max(vis.minX + 6, min(window.frame.origin.x, vis.maxX - window.frame.width - 6))
            let snappedY = vis.maxY - window.frame.height - 1
            dockedX = clampedX
            dockedScreen = screen
            isDockedTop = true
            isCollapsedToEdge = false
            outsideTicks = 0
            pauseAutoHideUntil = Date().addingTimeInterval(0.6)

            isProgrammaticMove = true
            window.setFrameOrigin(NSPoint(x: clampedX, y: snappedY))
            isProgrammaticMove = false

            applyWindowModeUI()
            syncWindowStateToWeb()
        } else {
            // Standalone free window!
            isDockedTop = false
            isCollapsedToEdge = false
            edgeWindow.orderOut(nil)
            applyWindowModeUI()
            syncWindowStateToWeb()
        }
    }

    private func currentScreenForWindow() -> NSScreen {
        let mouse = NSEvent.mouseLocation
        if let s = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) {
            return s
        }
        return window.screen ?? NSScreen.main ?? NSScreen.screens[0]
    }

    private func snapToTopEdgeAndDock() {
        let screen = window.screen ?? NSScreen.main ?? NSScreen.screens[0]
        let vis = screen.visibleFrame
        let w = window.frame.width
        let h = window.frame.height
        let targetX = max(vis.minX + 8, min(dockedX ?? window.frame.origin.x, vis.maxX - w - 8))
        let targetY = vis.maxY - h - 1

        dockedX = targetX
        dockedScreen = screen
        isDockedTop = true
        isCollapsedToEdge = false
        outsideTicks = 0
        pauseAutoHideUntil = Date().addingTimeInterval(1.2)
        edgeWindow.orderOut(nil)

        applyWindowModeUI()
        isProgrammaticMove = true
        window.setFrame(NSRect(x: targetX, y: targetY, width: w, height: h), display: true, animate: true)
        isProgrammaticMove = false
        syncWindowStateToWeb()
    }

    private func detachIntoFreeWindow() {
        isDockedTop = false
        isCollapsedToEdge = false
        edgeWindow.orderOut(nil)
        applyWindowModeUI()

        let screen = window.screen ?? NSScreen.main ?? NSScreen.screens[0]
        let vis = screen.visibleFrame
        var f = window.frame
        if vis.maxY - f.maxY < 32 {
            f.origin.y = max(vis.minY + 40, vis.maxY - f.height - 48)
            f.origin.x = max(vis.minX + 20, f.origin.x - 24)
            isProgrammaticMove = true
            window.setFrame(f, display: true, animate: true)
            isProgrammaticMove = false
        }
        syncWindowStateToWeb()
    }

    // MARK: - Top-Edge Auto-Hide & Auto-Expand Watcher
    private func startHoverWatcher() {
        hoverTimer?.invalidate()
        hoverTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            self?.tickHoverWatcher()
        }
    }

    private func tickHoverWatcher() {
        guard isDockedTop, !isUserDragging, !isAnimating else {
            outsideTicks = 0
            return
        }

        let mouse = NSEvent.mouseLocation
        let mousePressed = (NSEvent.pressedMouseButtons & 1) != 0

        if isCollapsedToEdge {
            guard edgeWindow.isVisible else { return }
            let triggerZone = edgeWindow.frame.insetBy(dx: -10, dy: -4)
            if NSMouseInRect(mouse, triggerZone, false) {
                expandFromTopEdge()
            }
        } else {
            guard window.isVisible else { return }
            if mousePressed || Date() < pauseAutoHideUntil {
                outsideTicks = 0
                return
            }
            // Generous zone around panel + top menu bar strip directly above it
            let f = window.frame
            let safeZone = NSRect(x: f.minX - 12, y: f.minY - 12, width: f.width + 24, height: f.height + 48)
            if NSMouseInRect(mouse, safeZone, false) {
                outsideTicks = 0
            } else {
                outsideTicks += 1
                if outsideTicks >= 3 { // ~240ms smooth debounce
                    outsideTicks = 0
                    collapseToTopEdge()
                }
            }
        }
    }

    private func collapseToTopEdge() {
        guard isDockedTop, !isCollapsedToEdge, !isAnimating else { return }
        isAnimating = true
        isCollapsedToEdge = true

        let screen = dockedScreen ?? window.screen ?? NSScreen.main ?? NSScreen.screens[0]
        let vis = screen.visibleFrame
        let curFrame = window.frame
        dockedX = curFrame.origin.x

        // Position sleek top-edge tab right at the top center of the panel's X
        let tabW: CGFloat = 140
        let tabH: CGFloat = 10
        let tabX = max(vis.minX + 8, min(round(curFrame.midX - tabW / 2.0), vis.maxX - tabW - 8))
        let tabY = vis.maxY - tabH
        edgeWindow.setFrame(NSRect(x: tabX, y: tabY, width: tabW, height: tabH), display: true)

        var slideUpFrame = curFrame
        slideUpFrame.origin.y += 28

        isProgrammaticMove = true
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.16
            ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
            window.animator().setFrame(slideUpFrame, display: true)
            window.animator().alphaValue = 0.0
        }, completionHandler: { [weak self] in
            guard let self = self else { return }
            self.window.orderOut(nil)
            self.window.alphaValue = 1.0
            self.window.setFrame(curFrame, display: false)
            self.isProgrammaticMove = false
            self.edgeWindow.orderFrontRegardless()
            self.isAnimating = false
        })
    }

    private func expandFromTopEdge() {
        guard isDockedTop, !isAnimating else { return }
        isAnimating = true
        isCollapsedToEdge = false
        outsideTicks = 0
        pauseAutoHideUntil = Date().addingTimeInterval(0.75)

        edgeWindow.orderOut(nil)

        let screen = dockedScreen ?? NSScreen.main ?? NSScreen.screens[0]
        let vis = screen.visibleFrame
        let w = window.frame.width
        let h = window.frame.height
        let x = max(vis.minX + 8, min(dockedX ?? round(vis.maxX - w - 24), vis.maxX - w - 8))
        let finalY = vis.maxY - h - 1

        let startFrame = NSRect(x: x, y: finalY + 24, width: w, height: h)
        let finalFrame = NSRect(x: x, y: finalY, width: w, height: h)

        applyWindowModeUI()
        isProgrammaticMove = true
        window.alphaValue = 0.0
        window.setFrame(startFrame, display: false)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(contentVC.webView)

        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.16
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            window.animator().setFrame(finalFrame, display: true)
            window.animator().alphaValue = 1.0
        }, completionHandler: { [weak self] in
            guard let self = self else { return }
            self.isProgrammaticMove = false
            self.isAnimating = false
            self.syncWindowStateToWeb()
        })
    }

    private func applyWindowModeUI() {
        contentVC.dragBar.isDockedTop = isDockedTop
        let showTraffic = !isDockedTop
        window.standardWindowButton(.closeButton)?.isHidden = !showTraffic
        window.standardWindowButton(.miniaturizeButton)?.isHidden = !showTraffic
        window.standardWindowButton(.zoomButton)?.isHidden = !showTraffic

        if isDockedTop {
            window.level = .floating
        } else {
            window.level = isAlwaysOnTop ? .floating : .normal
        }
    }

    private func syncWindowStateToWeb() {
        let js = "window.__onMacWindowMode && window.__onMacWindowMode({ dockedTop: \(isDockedTop ? "true" : "false"), pinned: \(isAlwaysOnTop ? "true" : "false") });"
        contentVC.webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        window.orderOut(nil)
        return false
    }

    // MARK: - Activate Existing Antigravity Window (NEVER spawn a new client!)
    private func activateExistingAntigravity() {
        let targetApp: NSRunningApplication? =
            NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.antigravity")
                .first(where: { !$0.isTerminated })
            ?? NSWorkspace.shared.runningApplications.first(where: {
                !$0.isTerminated &&
                $0.activationPolicy == .regular &&
                (($0.localizedName ?? "").localizedCaseInsensitiveContains("Antigravity") ||
                 ($0.bundleURL?.lastPathComponent ?? "").localizedCaseInsensitiveContains("Antigravity"))
            })

        guard let app = targetApp else { return }
        if #available(macOS 14.0, *) {
            NSApp.yieldActivation(to: app)
            app.unhide()
            app.activate(options: [.activateAllWindows])
        } else {
            app.unhide()
            app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
        }
    }

    private func setupContextMenu() {
        let openItem = NSMenuItem(title: "展开 / 收起多AI中枢 (⌃⌥J)", action: #selector(togglePanelFromMenuOrHotKey), keyEquivalent: "")
        openItem.target = self
        contextMenu.addItem(openItem)

        let dockItem = NSMenuItem(title: "吸回屏幕顶部自动隐藏", action: #selector(dockFromMenu), keyEquivalent: "")
        dockItem.target = self
        contextMenu.addItem(dockItem)

        let freeItem = NSMenuItem(title: "切换为独立常驻窗口", action: #selector(detachFromMenu), keyEquivalent: "")
        freeItem.target = self
        contextMenu.addItem(freeItem)

        let reloadItem = NSMenuItem(title: "刷新面板", action: #selector(reloadPanel), keyEquivalent: "r")
        reloadItem.target = self
        contextMenu.addItem(reloadItem)

        contextMenu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "退出多AI中枢", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        contextMenu.addItem(quitItem)
    }

    @objc private func dockFromMenu() {
        showInitialOrRestore()
        snapToTopEdgeAndDock()
    }

    @objc private func detachFromMenu() {
        showInitialOrRestore()
        detachIntoFreeWindow()
    }

    @objc private func handleStatusBarClick(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else {
            togglePanelFromMenuOrHotKey()
            return
        }
        if event.type == .rightMouseUp {
            statusItem.menu = contextMenu
            statusItem.button?.performClick(nil)
            statusItem.menu = nil
        } else {
            togglePanelFromMenuOrHotKey()
        }
    }

    private func computeInitialTopOrigin() -> (NSPoint, NSScreen) {
        if let button = statusItem.button, let btnWin = button.window {
            let btnFrame = btnWin.convertToScreen(button.convert(button.bounds, to: nil))
            let screen = btnWin.screen ?? NSScreen.main ?? NSScreen.screens[0]
            let vis = screen.visibleFrame
            let w = window.frame.width
            let h = window.frame.height
            var x = round(btnFrame.midX - w / 2.0)
            x = max(vis.minX + 8, min(x, vis.maxX - w - 8))
            let y = vis.maxY - h - 1
            return (NSPoint(x: x, y: y), screen)
        }
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let vis = screen.visibleFrame
        let x = vis.maxX - window.frame.width - 24
        let y = vis.maxY - window.frame.height - 1
        return (NSPoint(x: x, y: y), screen)
    }

    @objc func togglePanelFromMenuOrHotKey() {
        if isDockedTop {
            if isCollapsedToEdge || !window.isVisible {
                expandFromTopEdge()
            } else {
                collapseToTopEdge()
            }
        } else {
            if window.isVisible && window.isKeyWindow {
                window.orderOut(nil)
            } else {
                NSApp.activate(ignoringOtherApps: true)
                window.makeKeyAndOrderFront(nil)
                window.makeFirstResponder(contentVC.webView)
            }
        }
    }

    private func showInitialOrRestore() {
        if dockedX == nil {
            let (origin, screen) = computeInitialTopOrigin()
            dockedX = origin.x
            dockedScreen = screen
            isProgrammaticMove = true
            window.setFrameOrigin(origin)
            isProgrammaticMove = false
        }
        edgeWindow.orderOut(nil)
        isCollapsedToEdge = false
        pauseAutoHideUntil = Date().addingTimeInterval(2.2)
        applyWindowModeUI()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(contentVC.webView)
        syncWindowStateToWeb()
    }

    @objc private func reloadPanel() {
        if serverPort > 0, let url = URL(string: "http://127.0.0.1:\(serverPort)/") {
            contentVC.webView?.load(URLRequest(url: url))
        }
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    private func registerGlobalHotKey() {
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), hotKeyCallback, 1, &eventType, nil, nil)
        let hotKeyID = EventHotKeyID(signature: OSType(0x4A4D4842), id: 1)
        let modifiers = UInt32(controlKey | optionKey)
        RegisterEventHotKey(38, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    private func resolveNodePath() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "\(home)/.local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
        return candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) })
    }

    private func resolveServerScript() -> String {
        if let envPath = ProcessInfo.processInfo.environment["AI_HUB_SERVER_SCRIPT"],
           FileManager.default.fileExists(atPath: envPath) {
            return envPath
        }
        if let bundled = Bundle.main.object(forInfoDictionaryKey: "AIHubServerScript") as? String,
           FileManager.default.fileExists(atPath: bundled) {
            return bundled
        }
        return Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("server.mjs").path
    }

    private func startLocalServer() {
        let _ = contentVC.view

        guard let nodeBin = resolveNodePath() else {
            contentVC.webView.loadHTMLString("<body style='background:#f7f8fa;color:#dc2626;font-family:-apple-system;padding:20px'>未找到 Node.js，请确认 ~/.local/bin/node 可用。</body>", baseURL: nil)
            return
        }

        let serverScript = resolveServerScript()
        guard FileManager.default.fileExists(atPath: serverScript) else {
            contentVC.webView.loadHTMLString("<body style='background:#f7f8fa;color:#dc2626;font-family:-apple-system;padding:20px'>未找到中枢服务脚本：\(serverScript)</body>", baseURL: nil)
            return
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: nodeBin)
        proc.arguments = [serverScript, "--parent-watch"]

        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "\(home)/.local/bin:\(home)/.antigravity/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        proc.environment = env

        let inPipe = Pipe()
        let outPipe = Pipe()
        proc.standardInput = inPipe
        proc.standardOutput = outPipe
        proc.standardError = FileHandle.nullDevice

        self.stdinPipe = inPipe
        self.nodeProcess = proc

        outPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            for line in text.split(separator: "\n") {
                if line.hasPrefix("PORT="), let port = Int(line.dropFirst(5).trimmingCharacters(in: .whitespacesAndNewlines)) {
                    outPipe.fileHandleForReading.readabilityHandler = nil
                    DispatchQueue.main.async {
                        self?.serverPort = port
                        if let url = URL(string: "http://127.0.0.1:\(port)/") {
                            self?.contentVC.webView.load(URLRequest(url: url))
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                            self?.showInitialOrRestore()
                        }
                    }
                    break
                }
            }
        }

        do {
            try proc.run()
        } catch {
            contentVC.webView.loadHTMLString("<body style='background:#f7f8fa;color:#dc2626;font-family:-apple-system;padding:20px'>启动本地服务失败：\(error.localizedDescription)</body>", baseURL: nil)
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
