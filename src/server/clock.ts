/**
 * Sumber waktu tunggal untuk layer server (TESTING.md: waktu selalu diinjeksi).
 * Domain & engine menerima `now` sebagai argumen; hanya modul ini yang memanggil `new Date()`.
 */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
