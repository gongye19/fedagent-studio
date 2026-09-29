import type { ScenarioId } from "../domain/catalog";

/**
 * 首页场景卡片上的示意图：用一张数据表说明三种场景的区别，颜色深浅代表不同的参与方。
 * - 横向：字段相同，样本分在各方（按行切开）；
 * - 纵向：样本相同，字段分在各方（按列切开）；
 * - 迁移：已有领域的数据和经验，用到样本很少的新领域。
 * 纯示意，不可点，读屏跳过（卡片上的文字已经说明了）。
 */
type Tone = "head" | 1 | 2 | 3 | "empty";

function Grid({ x, y, rows, cols, width, height, tone }: {
  x: number;
  y: number;
  rows: number;
  cols: number;
  width: number;
  height: number;
  tone: (row: number, col: number) => Tone;
}) {
  const gap = 3;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const value = tone(row, col);
      cells.push(
        <rect
          key={`${row}-${col}`}
          className={`art-${value}`}
          x={x + col * (width + gap)}
          y={y + row * (height + gap)}
          width={width}
          height={height}
          rx={2}
        />,
      );
    }
  }
  return <>{cells}</>;
}

/** 示意图下面的一句话：数据在各方之间怎么分。 */
const CAPTIONS: Record<ScenarioId, string> = {
  horizontal: "字段相同，样本分在各方",
  vertical: "样本相同，字段分在各方",
  transfer: "已有领域 → 新领域",
};

export function ScenarioArt({ scenario }: { scenario: ScenarioId }) {
  return (
    <>
      <Art scenario={scenario} />
      <span className="scenario-art-caption">{CAPTIONS[scenario]}</span>
    </>
  );
}

function Art({ scenario }: { scenario: ScenarioId }) {
  return (
    <svg viewBox="0 0 168 88" aria-hidden="true" focusable="false">
      {scenario === "horizontal" ? (
        <Grid x={13} y={7} rows={7} cols={5} width={26} height={8} tone={(row) => (row === 0 ? "head" : row <= 2 ? 1 : row <= 4 ? 2 : 3)} />
      ) : null}
      {scenario === "vertical" ? (
        <Grid x={13.5} y={7} rows={7} cols={6} width={21} height={8} tone={(row, col) => (row === 0 ? "head" : col <= 1 ? 1 : col <= 3 ? 2 : 3)} />
      ) : null}
      {scenario === "transfer" ? (
        <>
          <Grid x={14} y={15.5} rows={5} cols={3} width={16} height={9} tone={(row) => (row === 0 ? "head" : 1)} />
          <path className="art-arrow" d="M77 44 H90 M86 40 L90 44 L86 48" />
          <Grid x={100} y={15.5} rows={5} cols={3} width={16} height={9} tone={(row) => (row === 0 ? "head" : row === 1 ? 2 : "empty")} />
        </>
      ) : null}
    </svg>
  );
}
