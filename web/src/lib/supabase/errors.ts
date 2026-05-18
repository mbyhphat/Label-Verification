const errorHints: Record<string, string> = {
  lock_conflict:
    'Item này đang được người khác giữ lock. Hãy thử lại sau.',
  lock_conflict_or_stale_version:
    'Item này đang được người khác giữ lock hoặc dữ liệu đã cũ. Hãy refresh danh sách rồi thử lại.',
  lock_required:
    'Bạn cần acquire lock trước khi submit item này.',
  stale_version:
    'Dữ liệu đã thay đổi ở phiên bản mới hơn. Hãy mở lại sample trước khi submit.',
  not_allowed:
    'Tài khoản này chưa có quyền review project.',
  not_authenticated:
    'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
  entity_import_exists:
    'Entity này đã được import. Bật Replace nếu muốn ghi đè.',
  sample_count_changed:
    'Dataset đã tồn tại nhưng số sample khác với file mới.',
  samples_changed:
    'Dataset đã tồn tại nhưng samples.json đã thay đổi.',
  chunk_offset_mismatch:
    'Import samples bị gián đoạn giữa chừng. Xóa dataset rồi import lại.',
  invalid_review_row:
    'Có audit row thiếu value hoặc sample_index không hợp lệ. Deploy lại Edge Function mới nhất hoặc sửa audit.json.',
  invalid_review_rows:
    'Payload review_rows không hợp lệ.',
}

export function formatSupabaseError(error: unknown) {
  if (!error) {
    return 'Unknown Supabase error.'
  }

  if (typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: string }).message ?? '')
    for (const [code, hint] of Object.entries(errorHints)) {
      if (message === code || message.startsWith(code + ':')) return hint
    }
    return message
  }

  return String(error)
}
