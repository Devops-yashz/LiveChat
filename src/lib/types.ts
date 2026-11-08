export interface Profile {
  id: string; username: string; display_name: string | null; avatar_path: string | null;
  show_online_status: boolean; send_read_receipts: boolean; share_typing: boolean; last_seen_at: string | null;
}
export interface ConversationRow {
  conversation_id: string; expires_at: string; created_at: string;
  other_user_id: string; other_username: string; other_display_name: string | null; other_avatar_path: string | null;
  other_last_seen_at: string | null; other_status: 'active' | 'ended'; unread_count: number; last_message_at: string | null;
}
export interface Message {
  id: string; conversation_id: string; sender_id: string; kind: 'text' | 'image' | 'system';
  body: string | null; created_at: string; expires_at: string; delivered_at: string | null; read_at: string | null;
}
export interface Invitation {
  id: string; inviter_id: string; invitee_id: string | null; target_label: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled'; created_at: string; expires_at: string; conversation_id: string | null;
}
export interface CallSession {
  id: string; conversation_id: string; caller_id: string; callee_id: string; type: 'video' | 'audio';
  status: 'ringing' | 'active' | 'ended' | 'rejected' | 'missed'; created_at: string;
}
