import { describe, expect, it } from 'vitest';
import { leadingEmoji } from './leading-emoji';

describe('leadingEmoji', () => {
  it.each([
    ['🏠 Home', '🏠'],
    ['🏠Home', '🏠'],
    ['👩🏽‍💻 Work', '👩🏽‍💻'],
    ['🇧🇩 Dhaka', '🇧🇩'],
    ['1️⃣ First', '1️⃣'],
    ['❤️ Health', '❤️'],
  ])('finds the emoji at the start of %j', (title, emoji) => {
    expect(leadingEmoji(title)).toBe(emoji);
  });

  it.each(['Home', '1 Project', '#1 Project', ' 🏠 Home', 'Home 🏠', ''])('finds no emoji in %j', (title) => {
    expect(leadingEmoji(title)).toBeNull();
  });
});
