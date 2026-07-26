export const MAX_ACTIVITY_TEXT_LENGTH = 300;

export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;
