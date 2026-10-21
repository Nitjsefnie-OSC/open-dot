import AppKit
import SwiftUI

let expandedSize = CGSize(width: 520, height: 440)
let earWidth: CGFloat = 26

struct RootView: View {
  @Bindable var store: Store
  let topInset: CGFloat
  let collapsedRadius: CGFloat
  let onIndicatorChange: () -> Void

  var body: some View {
    let radius = store.expanded ? 22 : collapsedRadius
    ZStack(alignment: .top) {
      if store.expanded {
        ExpandedView(store: store, topInset: topInset)
          .frame(width: expandedSize.width, height: expandedSize.height)
          .transition(.opacity)
      } else if store.showsIndicator {
        HStack {
          if store.dots.contains(where: \.busy) { BusyDot() }
          Spacer()
          if store.dots.contains(where: { store.unread($0.name) }) { UnreadDot() }
        }
        .padding(.horizontal, 10)
        .frame(height: topInset)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(.black)
    .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: radius, bottomTrailingRadius: radius))
    .environment(\.colorScheme, .dark)
    .onChange(of: store.showsIndicator) { onIndicatorChange() }
  }
}

struct BusyDot: View {
  var body: some View {
    Image(systemName: "circle.fill").font(.system(size: 6)).foregroundStyle(.orange).symbolEffect(.pulse)
  }
}

struct UnreadDot: View {
  var body: some View {
    Circle().fill(.blue).frame(width: 6, height: 6)
  }
}

struct ExpandedView: View {
  @Bindable var store: Store
  let topInset: CGFloat

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let status = store.status {
        centered(status)
      } else if let name = store.selected, let dot = store.dots.first(where: { $0.name == name }) {
        tabs
        Conversation(store: store, name: name)
        if !dot.workers.isEmpty { workers(dot.workers) }
        composer(name)
      } else {
        centered(store.loaded ? "No dots yet. Create one with open-dot create." : "Connecting…")
      }
    }
    .padding(.top, topInset + 6)
    .padding([.horizontal, .bottom], 14)
    .foregroundStyle(.white)
    .contextMenu { Button("Quit open-dot notch") { NSApp.terminate(nil) } }
  }

  private func centered(_ text: String) -> some View {
    Text(text).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var tabs: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 4) {
        ForEach(store.dots, id: \.name) { dot in
          Button { store.select(dot.name) } label: {
            HStack(spacing: 5) {
              if dot.busy { BusyDot() }
              Text(dot.name).font(.callout.weight(.medium))
              if store.unread(dot.name) { UnreadDot() }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(.white.opacity(dot.name == store.selected ? 0.18 : 0)))
            .contentShape(Capsule())
          }
          .buttonStyle(.plain)
          .help(dot.purpose ?? "")
          .accessibilityIdentifier("dot-tab-\(dot.name)")
        }
      }
    }
    .scrollIndicators(.hidden)
  }

  private func workers(_ workers: [Dot.Worker]) -> some View {
    ScrollView(.horizontal) {
      HStack(spacing: 6) {
        ForEach(workers, id: \.id) { worker in
          Text("#\(worker.id) \(worker.state) · \(worker.task)")
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .frame(maxWidth: 220)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(.white.opacity(0.08)))
        }
      }
    }
    .scrollIndicators(.hidden)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("workers")
  }

  private func composer(_ name: String) -> some View {
    let empty = store.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    return HStack {
      TextField("Message \(name)", text: $store.draft)
        .textFieldStyle(.plain)
        .onSubmit { store.send() }
        .accessibilityIdentifier("composer")
      Button { store.send() } label: {
        Image(systemName: "arrow.up.circle.fill").font(.title2)
      }
      .buttonStyle(.plain)
      .disabled(empty)
      .opacity(empty ? 0.4 : 1)
      .accessibilityLabel("Send")
      .accessibilityIdentifier("send")
    }
    .padding(.leading, 12)
    .padding(.trailing, 6)
    .padding(.vertical, 6)
    .background(RoundedRectangle(cornerRadius: 14).fill(.white.opacity(0.08)))
  }
}

struct Conversation: View {
  let store: Store
  let name: String

  var body: some View {
    let messages = store.messages[name] ?? []
    let pending = store.pending[name] ?? []
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(messages) { MessageRow(message: $0) }
          ForEach(pending) { item in
            PendingRow(item: item).onTapGesture {
              if item.error != nil { store.dismiss(name, item.id) }
            }
          }
          Color.clear.frame(height: 1).id("end")
        }
      }
      .defaultScrollAnchor(.bottom)
      .scrollIndicators(.never)
      .onChange(of: "\(name) \(messages.last?.id ?? "") \(pending.count)") { proxy.scrollTo("end", anchor: .bottom) }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("message-list")
  }
}

struct MessageRow: View {
  let message: Message
  @State private var open = false

  var body: some View {
    switch message.kind {
    case "owner":
      HStack {
        Spacer(minLength: 60)
        Bubble(text: message.text, shade: 0.18)
      }
    case "dot":
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          if !message.text.isEmpty { Bubble(text: message.text, shade: 0.08) }
          if let tools = message.tools, !tools.isEmpty {
            Text("used \(tools.joined(separator: ", "))").font(.caption2).foregroundStyle(.tertiary)
          }
        }
        Spacer(minLength: 60)
      }
    default:
      VStack(alignment: .leading, spacing: 2) {
        Text(message.kind == "peer" ? "from \(message.peer ?? "another dot")" : "open-dot")
          .font(.caption2.weight(.semibold))
        Text(message.text).font(.caption).lineLimit(open ? nil : 4)
      }
      .foregroundStyle(.secondary)
      .padding(8)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: 8).fill(.white.opacity(0.05)))
      .onTapGesture { open.toggle() }
    }
  }
}

struct PendingRow: View {
  let item: Pending

  var body: some View {
    HStack {
      Spacer(minLength: 60)
      VStack(alignment: .trailing, spacing: 3) {
        Bubble(text: item.text, shade: 0.18).opacity(0.6)
        if let error = item.error {
          Text("\(error) · click to dismiss").font(.caption2).foregroundStyle(.red)
        } else {
          Text("sending…").font(.caption2).foregroundStyle(.tertiary)
        }
      }
    }
  }
}

struct Bubble: View {
  let text: String
  let shade: Double

  var body: some View {
    Text(markdown(text))
      .textSelection(.enabled)
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
      .background(RoundedRectangle(cornerRadius: 12).fill(.white.opacity(shade)))
  }

  private func markdown(_ text: String) -> AttributedString {
    let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
  }
}
