import AppKit
import SwiftUI

final class Panel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

final class HostingView<Content: View>: NSHostingView<Content> {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class HoverView: NSView {
  var onHover: (Bool) -> Void = { _ in }

  override init(frame: NSRect) {
    super.init(frame: frame)
    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }

  required init?(coder: NSCoder) { nil }

  override func mouseEntered(with event: NSEvent) { onHover(true) }
  override func mouseExited(with event: NSEvent) { onHover(false) }
}

struct Notch {
  let center: CGFloat
  let top: CGFloat
  let size: CGSize
  let radius: CGFloat

  init(_ screen: NSScreen) {
    let frame = screen.frame
    if screen.safeAreaInsets.top > 0, let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
      let width = frame.width - left.width - right.width
      size = CGSize(width: width, height: screen.safeAreaInsets.top)
      center = frame.minX + left.width + width / 2
      radius = 8
    } else {
      let height = max(frame.maxY - screen.visibleFrame.maxY, 24)
      size = CGSize(width: 160, height: height)
      center = frame.midX
      radius = height / 2
    }
    top = frame.maxY
  }

  func frame(expanded: Bool, indicator: Bool) -> NSRect {
    let width = expanded ? expandedSize.width : size.width + (indicator ? earWidth * 2 : 0)
    let height = expanded ? expandedSize.height : size.height
    return NSRect(x: center - width / 2, y: top - height, width: width, height: height)
  }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
  private let store = Store()
  private let pinned = ProcessInfo.processInfo.environment["OPEN_DOT_NOTCH_PINNED"] == "1"
  private let panel = Panel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
  private var hosting: HostingView<RootView>?
  private var notch: Notch?
  private var collapse: Task<Void, Never>?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    panel.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 3)
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.isMovable = false
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = true

    let hover = HoverView(frame: .zero)
    hover.onHover = { [weak self] inside in self?.hover(inside) }
    panel.contentView = hover
    store.expanded = pinned
    screenChanged()
    panel.orderFrontRegardless()
    store.start()

    NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.screenChanged() }
    }
  }

  private func screenChanged() {
    guard let screen = NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 }) ?? NSScreen.main, let hover = panel.contentView else { return }
    let notch = Notch(screen)
    self.notch = notch
    let root = RootView(store: store, topInset: notch.size.height, collapsedRadius: notch.radius) { [weak self] in
      self?.place(animated: true)
    }
    if let hosting {
      hosting.rootView = root
    } else {
      let hosting = HostingView(rootView: root)
      // Without this the hosting view pins the window to SwiftUI's ideal size and fights the resize.
      hosting.sizingOptions = []
      hosting.frame = hover.bounds
      hosting.autoresizingMask = [.width, .height]
      hover.addSubview(hosting)
      self.hosting = hosting
    }
    place(animated: false)
  }

  private func place(animated: Bool) {
    guard let notch else { return }
    let frame = notch.frame(expanded: store.expanded, indicator: store.showsIndicator)
    guard animated else { return panel.setFrame(frame, display: true) }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.22
      context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      panel.animator().setFrame(frame, display: true)
    }
  }

  private func hover(_ inside: Bool) {
    guard !pinned else { return }
    collapse?.cancel()
    if inside { return expand(true) }
    collapse = Task {
      try? await Task.sleep(for: .milliseconds(400))
      if !Task.isCancelled { expand(false) }
    }
  }

  private func expand(_ expanded: Bool) {
    guard store.expanded != expanded else { return }
    // Ordering the panel out hands keyboard focus back to the app the owner was using.
    if !expanded && panel.isKeyWindow {
      panel.orderOut(nil)
      panel.orderFrontRegardless()
    }
    withAnimation(.easeInOut(duration: 0.22)) { store.expanded = expanded }
    place(animated: true)
    if expanded { store.opened() }
  }
}

let delegate = AppDelegate()
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
