export function gameRoom(gameId: string): string {
  return `game:${gameId}`;
}

export function guestRoom(guestSessionId: string): string {
  return `guest:${guestSessionId}`;
}
