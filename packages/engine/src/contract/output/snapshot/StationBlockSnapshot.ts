/** Место, непосредственно блокирующее выгрузку поста. */
export interface StationBlockSnapshot {
  /** ID блокирующего поста. */
  stationId: string;
  /** Заполненный вход получателя или собственный выход поста. */
  location: 'input' | 'output';
}
