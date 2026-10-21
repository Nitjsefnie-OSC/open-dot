import Foundation
import Observation

struct Pending: Identifiable {
  let id = UUID()
  let text: String
  var messageID: String?
  var error: String?
}

@MainActor @Observable final class Store {
  var dots: [Dot] = []
  var status: String?
  var loaded = false
  var selected: String?
  var messages: [String: [Message]] = [:]
  var pending: [String: [Pending]] = [:]
  var draft = ""
  var expanded = false
  private var seen: [String: Double] = [:]
  private var newest: [String: Double] = [:]
  @ObservationIgnored private let api = API()

  var showsIndicator: Bool { status == nil && dots.contains { $0.busy || unread($0.name) } }

  func unread(_ name: String) -> Bool { (newest[name] ?? 0) > (seen[name] ?? .infinity) }

  func start() {
    Task {
      while true {
        await refreshDots()
        try? await Task.sleep(for: .seconds(expanded ? 1 : 2))
      }
    }
    Task {
      while true {
        if expanded, let name = selected { await refreshMessages(name) }
        try? await Task.sleep(for: .seconds(1))
      }
    }
    // The dot list carries no message times, so other dots' messages are swept slowly
    // to light the unread indicator.
    Task {
      while true {
        for dot in dots where !(expanded && dot.name == selected) { await refreshMessages(dot.name) }
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }

  func opened() {
    Task { await refreshDots() }
    if let name = selected { Task { await refreshMessages(name) } }
  }

  func select(_ name: String) {
    selected = name
    seen[name] = newest[name]
    Task { await refreshMessages(name) }
  }

  func send() {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let name = selected, !text.isEmpty else { return }
    draft = ""
    let item = Pending(text: text)
    pending[name, default: []].append(item)
    Task {
      do {
        let id = try await api.post(name, text: text)
        update(name, item.id) { $0.messageID = id }
      } catch {
        update(name, item.id) { $0.error = Self.describe(error) }
      }
    }
  }

  func dismiss(_ name: String, _ id: UUID) {
    pending[name]?.removeAll { $0.id == id }
  }

  private func refreshDots() async {
    do {
      let next = try await api.dots()
      let finished = dots.filter { old in old.busy && next.contains { $0.name == old.name && !$0.busy } }
      dots = next
      status = nil
      if !next.contains(where: { $0.name == selected }) { selected = next.first?.name }
      for dot in finished { Task { await refreshMessages(dot.name) } }
    } catch {
      status = Self.describe(error)
    }
    loaded = true
  }

  private func refreshMessages(_ name: String) async {
    guard let list = try? await api.messages(name) else { return }
    messages[name] = list
    let ids = Set(list.map(\.id))
    pending[name]?.removeAll { $0.messageID.map(ids.contains) ?? false }
    let latest = list.filter { $0.kind != "owner" }.map(\.time).max() ?? 0
    newest[name] = latest
    if seen[name] == nil || (expanded && selected == name) { seen[name] = latest }
  }

  private func update(_ name: String, _ id: UUID, _ change: (inout Pending) -> Void) {
    guard let index = pending[name]?.firstIndex(where: { $0.id == id }) else { return }
    change(&pending[name]![index])
  }

  private static func describe(_ error: Error) -> String {
    (error as? APIError)?.message ?? error.localizedDescription
  }
}
