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
}

export function formatSupabaseError(error: unknown) {
  if (!error) {
    return 'Unknown Supabase error.'
  }

  if (typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: string }).message ?? '')
    return errorHints[message] ?? message
  }

  return String(error)
}
