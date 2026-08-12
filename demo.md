# The Quiet Craft of Reading

Reading is not one skill but a stack of them: decoding, holding a thread, letting an argument build. A good reading environment removes everything that competes with that thread — and for an easily-pulled-away mind, *removes* is the operative word.

This page is the demo document for **mdread**. Scroll around and try the toolbar (top right) or the keyboard: `t` contents, `f` focus, `b` bionic, `d` theme, `+`/`−` text size.

## Why another reader

Most markdown previews are developer tools: cramped, cluttered, styled as an afterthought. A book, by contrast, makes a few strong choices and then gets out of the way:

- One comfortable column, around 65 characters wide
- Generous line height and real margins
- A clear rhythm of headings, so you always know where you are
- Nothing blinking, docked, or begging for attention

> The page is an instrument for the eye, and like any instrument it should be tuned, then trusted, then forgotten.

### Focus mode

Press `f`. Everything except the paragraph at your reading line fades back. This is the digital version of holding a ruler under the sentence you're on — a genuinely useful trick when your eyes tend to skip ahead or wander.

### Bionic reading

Press `b`. The first part of each word is bolded, giving your eye an anchor point to jump between. Some people find it gimmicky; many people with ADHD swear by it. It's a toggle, so it costs nothing to try.

## The details hold up too

Code blocks are highlighted and stay out of the reading column's way:

```js
function readingTime(text, wpm = 220) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / wpm));
}
```

Tables stay quiet and legible:

| Element | Choice | Reason |
| --- | --- | --- |
| Measure | ~65 ch | The eye finds the next line without effort |
| Leading | 1.7 | Room for the line to breathe |
| Serif | Iowan / Palatino | Book texture, not office memo |

Task lists work as you'd expect:

- [x] Parse markdown with GFM extras
- [x] Live-reload when the file changes on disk
- [ ] Read something longer than a README with it

---

## Colophon

Three themes — paper, sepia, and a warm dark — cycle with `d`. Your theme, text size, typeface, and toggles are remembered between sessions. The thin line at the very top is how far along you are; the reading time estimate is in the header.

That's the whole idea: a page that behaves like a well-made book, for files that usually get read in a code editor.
