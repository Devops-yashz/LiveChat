const EMOJIS = '😀 😂 🤣 😊 😍 😘 😎 🤔 😅 😭 😡 🥳 😴 🙏 👍 👎 👏 🙌 💪 🔥 ✨ 🎉 ❤️ 💔 💯 😉 😇 🤗 🤩 😢 😮 🙄 😬 🤝 👋 🍕 ☕ 🎂 🌹 🌟'.split(' ');

export default function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  return (
    <div className="absolute bottom-14 left-0 z-20 grid w-72 grid-cols-8 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl animate-slide-up dark:border-slate-700 dark:bg-slate-900">
      {EMOJIS.map((e) => (
        <button key={e} type="button" className="rounded-lg p-1 text-xl hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => onPick(e)}>{e}</button>
      ))}
    </div>
  );
}
