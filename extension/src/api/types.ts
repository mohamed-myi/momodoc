/** Represents a project from the API. */
export interface Project {
    id: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
    file_count: number;
    note_count: number;
    issue_count: number;
}

/** Represents a chat session from the API. */
export interface ChatSession {
    id: string;
    project_id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
}

/** Represents a chat source from the API. */
export interface ChatSource {
    source_type: string;
    source_id: string;
    filename: string | null;
    original_path: string | null;
    chunk_text: string;
    chunk_index: number;
    score: number;
}

/** Represents a chat message from the API. */
export interface ChatMessage {
    id: string;
    session_id: string;
    role: string;
    content: string;
    sources: ChatSource[];
    created_at: string;
}

/** Represents a non-streaming chat response from the API. */
export interface ChatResponse {
    answer: string;
    sources: ChatSource[];
    model: string;
    user_message_id: string;
    assistant_message_id: string;
}

/** Represents an LLM provider status from the API. */
export interface LLMProviderInfo {
    name: string;
    available: boolean;
    model: string;
}

/** Represents a file record from the API. */
export interface FileRecord {
    id: string;
    project_id: string;
    filename: string;
    original_path: string | null;
    file_type: string;
    file_size: number;
    chunk_count: number;
    indexed_at: string | null;
    created_at: string;
}

/** Callback type for streaming events. */
export interface StreamCallbacks {
    onSources?: (sources: ChatSource[]) => void;
    onToken?: (token: string) => void;
    onDone?: (messageId: string) => void;
    onError?: (error: string) => void;
}
