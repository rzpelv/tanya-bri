import { Fragment } from "react";

function inline(text, onCite, keyBase) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\](?:\[\d+\])*)/g);
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (/^\[\d+\]/.test(part)) {
      const nums = [...part.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      return (
        <Fragment key={key}>
          {nums.map((n) => (
            <button key={n} type="button" className="cite" onClick={() => onCite?.(n)}>
              {n}
            </button>
          ))}
        </Fragment>
      );
    }
    return part.replace(/\*(\S[^*]*\S|\S)\*/g, "$1");
  });
}

export function Markdown({ text, onCite }) {
  const blocks = [];
  let list = null;
  text.split("\n").forEach((raw) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const type = bullet ? "ul" : "ol";
      if (!list || list.type !== type) {
        list = { type, items: [] };
        blocks.push(list);
      }
      list.items.push(bullet ? bullet[1] : numbered[2]);
      return;
    }
    list = null;
    if (!line.trim()) return;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    blocks.push({ type: heading ? "h" : "p", text: heading ? heading[1] : line });
  });
  return (
    <div className="markdown">
      {blocks.map((b, i) => {
        if (b.type === "ul" || b.type === "ol") {
          const List = b.type;
          return (
            <List key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{inline(item, onCite, `${i}-${j}`)}</li>
              ))}
            </List>
          );
        }
        if (b.type === "h") return <h4 key={i}>{inline(b.text, onCite, i)}</h4>;
        return <p key={i}>{inline(b.text, onCite, i)}</p>;
      })}
    </div>
  );
}
