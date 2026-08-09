import Foundation

public enum OpenClawChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(OpenClawChatEventPayload)
    case sessionMessage(OpenClawSessionMessageEventPayload)
    case agent(OpenClawAgentEventPayload)
    case seqGap
}

/// Privacy-safe lifecycle markers emitted before `chat.send` reaches the transport.
///
/// Transports may use these markers for explicitly enabled diagnostics. The markers carry only
/// correlation IDs already used by `chat.send`, counts, and phase names—never message content.
public enum OpenClawChatSendPreparationPhase: String, Sendable {
    case started
    case optimisticAppendCompleted
    case modelPatchWaitStarted
    case modelPatchWaitEnded
}

public enum OpenClawChatModelCatalogCompleteness: String, Codable, Sendable {
    case complete
    case incomplete
    case unknown
}

public struct OpenClawChatModelCatalogSnapshot: Sendable {
    public let models: [OpenClawChatModelChoice]
    public let completeness: OpenClawChatModelCatalogCompleteness
    public let provenance: String?

    public init(
        models: [OpenClawChatModelChoice],
        completeness: OpenClawChatModelCatalogCompleteness,
        provenance: String? = nil)
    {
        self.models = models
        self.completeness = completeness
        self.provenance = provenance
    }
}

public protocol OpenClawChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> OpenClawChatHistoryPayload
    func listModels() async throws -> [OpenClawChatModelChoice]
    func listModelCatalog() async throws -> OpenClawChatModelCatalogSnapshot
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [OpenClawChatAttachmentPayload]) async throws -> OpenClawChatSendResponse

    func observeSendPreparation(
        sessionKey: String,
        idempotencyKey: String,
        phase: OpenClawChatSendPreparationPhase,
        startedAtUptimeNanoseconds: UInt64,
        messageLength: Int,
        attachmentsCount: Int) async

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> OpenClawChatSessionsListResponse
    func setSessionModel(sessionKey: String, model: String?) async throws
    func setSessionThinking(sessionKey: String, thinkingLevel: String) async throws

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<OpenClawChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
    func resetSession(sessionKey: String) async throws
    func compactSession(sessionKey: String) async throws
}

extension OpenClawChatTransport {
    public func observeSendPreparation(
        sessionKey _: String,
        idempotencyKey _: String,
        phase _: OpenClawChatSendPreparationPhase,
        startedAtUptimeNanoseconds _: UInt64,
        messageLength _: Int,
        attachmentsCount _: Int) async {}

    public func setActiveSessionKey(_: String) async throws {}

    public func resetSession(sessionKey _: String) async throws {
        throw NSError(
            domain: "OpenClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.reset not supported by this transport"])
    }

    public func compactSession(sessionKey _: String) async throws {
        throw NSError(
            domain: "OpenClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.compact not supported by this transport"])
    }

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "OpenClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> OpenClawChatSessionsListResponse {
        throw NSError(
            domain: "OpenClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }

    public func listModels() async throws -> [OpenClawChatModelChoice] {
        throw NSError(
            domain: "OpenClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "models.list not supported by this transport"])
    }

    public func listModelCatalog() async throws -> OpenClawChatModelCatalogSnapshot {
        OpenClawChatModelCatalogSnapshot(
            models: try await self.listModels(),
            completeness: .unknown)
    }

    public func setSessionModel(sessionKey _: String, model _: String?) async throws {
        throw NSError(
            domain: "OpenClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.patch(model) not supported by this transport"])
    }

    public func setSessionThinking(sessionKey _: String, thinkingLevel _: String) async throws {
        throw NSError(
            domain: "OpenClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.patch(thinkingLevel) not supported by this transport"])
    }
}
