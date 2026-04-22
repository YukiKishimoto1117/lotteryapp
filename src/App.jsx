import { useState, useRef } from "react";
import Papa from "papaparse";

/* ================================================================
   Utilities
   ================================================================ */
function zenkakuToHankaku(text) {
  if (!text) return text;
  let t = String(text);
  const zen = "０１２３４５６７８９";
  const han = "0123456789";
  for (let i = 0; i < zen.length; i++) t = t.replaceAll(zen[i], han[i]);
  t = t.replace(/[－ー―‐]/g, "-");
  return t;
}

function extractNumbers(text) {
  if (!text) return "";
  const km = {"一":"1","二":"2","三":"3","四":"4","五":"5","六":"6","七":"7","八":"8","九":"9","〇":"0","０":"0","１":"1","２":"2","３":"3","４":"4","５":"5","６":"6","７":"7","８":"8","９":"9"};
  let t = String(text);
  for (const [k, v] of Object.entries(km)) t = t.replaceAll(k, v);
  const nums = t.match(/\d+/g);
  return nums ? nums.join("-") : "";
}

function buildHKey(zip, address, building) {
  return `${zip}_${extractNumbers(address)}_${extractNumbers(building)}`;
}

function normName(name) {
  return (name || "").replace(/[\s　]+/g, "");
}

function mkRng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function autoDetect(fields, hints) {
  for (const h of hints) {
    const e = fields.find((f) => f.trim() === h.trim());
    if (e) return e;
  }
  for (const h of hints) {
    const p = fields.find((f) => f.includes(h) || h.includes(f.trim()));
    if (p) return p;
  }
  return "";
}

function parseAppDate(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function downloadCsvBlob(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ================================================================
   Config
   ================================================================ */
const DEFAULT_KW = [
  {date:"2026-03-09",keyword:"ここあ"},{date:"2026-03-10",keyword:"おすし"},
  {date:"2026-03-11",keyword:"さうな"},{date:"2026-03-12",keyword:"なのはな"},
  {date:"2026-03-13",keyword:"さくらもち"},{date:"2026-03-16",keyword:"ほうれんそう"},
  {date:"2026-03-17",keyword:"ふきのとう"},{date:"2026-03-18",keyword:"おおかみ"},
  {date:"2026-03-19",keyword:"ますく"},{date:"2026-03-20",keyword:"あんこ"},
  {date:"2026-03-23",keyword:"たおる"},{date:"2026-03-24",keyword:"めろん"},
  {date:"2026-03-25",keyword:"ふとん"},{date:"2026-03-26",keyword:"たらのめ"},
  {date:"2026-03-27",keyword:"たけのこ"},
];

const REQ_COLS = [
  {key:"datetime",label:"応募日時",hints:["応募日時","create_datetime"]},
  {key:"name",label:"名前",hints:["名前","full_name"]},
  {key:"email",label:"メールアドレス",hints:["メールアドレス","mail_address"]},
  {key:"zip",label:"郵便番号",hints:["郵便番号","zip"]},
  {key:"prefecture",label:"都道府県",hints:["都道府県","prefectures"]},
  {key:"address",label:"町名・番地",hints:["町名・番地","address"]},
  {key:"building",label:"建物名",hints:["アパート名","building_name"]},
  {key:"birthday",label:"生年月日",hints:["生年月日","birthday"]},
  {key:"keyword",label:"キーワード",hints:["キーワード","keyword"]},
];

const OPT_COLS = [
  {key:"applicant_id",label:"応募ID",hints:["応募データID","applicant_id"]},
  {key:"sex",label:"性別",hints:["性別","sex"]},
  {key:"city",label:"市町村",hints:["市町村","city"]},
  {key:"phone",label:"電話番号",hints:["電話番号","phone"]},
  {key:"device",label:"応募経路",hints:["応募経路","device"]},
  {key:"job",label:"職業",hints:["職業","job"]},
  {key:"email_reject",label:"メール許諾",hints:["メール許諾","email_reject"]},
];

const PW_COLS = [
  {key:"pw_name",label:"名前",hints:["名前","full_name","氏名"]},
  {key:"pw_zip",label:"郵便番号",hints:["郵便番号","zip"]},
  {key:"pw_address",label:"町名・番地",hints:["町名・番地","address","住所"]},
  {key:"pw_building",label:"建物名",hints:["アパート名","building_name","建物名"]},
];

const T_COLS = [
  {h:"応募日",fn:(r)=>r._appDate},
  {h:"当選区分",fn:(r)=>r._result},
  {h:"年齢区分",fn:(r)=>r._ageGroup},
  {h:"名前",fn:(r)=>r._name},
  {h:"年齢",fn:(r)=>r._age},
  {h:"性別",fn:(r,om)=>om.sex?(r[om.sex]||""):""},
  {h:"都道府県",fn:(r,om,rm)=>r[rm.prefecture]},
  {h:"市町村",fn:(r,om)=>om.city?(r[om.city]||""):""},
  {h:"町名・番地",fn:(r)=>r._address},
  {h:"建物名",fn:(r)=>r._building||""},
  {h:"郵便番号",fn:(r,om,rm)=>r[rm.zip]},
  {h:"電話番号",fn:(r,om)=>om.phone?(r[om.phone]||""):""},
  {h:"メールアドレス",fn:(r)=>r._personKey},
  {h:"キーワード",fn:(r,om,rm)=>(r[rm.keyword]||"").trim()},
  {h:"世帯キー",fn:(r)=>r._householdKey},
];

const SEED = 42;

/* ================================================================
   Styles
   ================================================================ */
const si = {width:"100%",padding:"7px 10px",fontSize:13,boxSizing:"border-box",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:4,color:"#e8e6e1",outline:"none"};
const ss = (ok) => ({width:"100%",padding:"6px 8px",fontSize:12,boxSizing:"border-box",background:ok?"rgba(255,255,255,0.04)":"rgba(255,60,60,0.08)",border:`1px solid ${ok?"rgba(255,255,255,0.1)":"rgba(255,60,60,0.3)"}`,borderRadius:4,color:"#e8e6e1",outline:"none"});
const so = {width:"100%",padding:"6px 8px",fontSize:12,boxSizing:"border-box",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:4,color:"#aaa",outline:"none"};

/* ================================================================
   Lottery logic (pure function)
   ================================================================ */
function runLotteryLogic(csvData, rMap, oMap, keywords, prefs, winU, winO, rsvU, rsvO, baseYear, boundary, pwFiles, lotteryMode) {
  const logs = [];
  const kwMap = {};
  keywords.forEach((kw) => { kwMap[kw.date] = kw.keyword; });

  const pwNameHK = new Set();
  const pwHK = new Set();
  pwFiles.forEach((pw) => {
    pw.data.forEach((row) => {
      const name = normName(row[pw.colMap.pw_name]);
      const hk = buildHKey(row[pw.colMap.pw_zip]||"", row[pw.colMap.pw_address]||"", row[pw.colMap.pw_building]||"");
      if (name && hk && hk !== "__") {
        pwNameHK.add(`${name}__${hk}`);
        pwHK.add(hk);
      }
    });
  });
  if (pwNameHK.size > 0) {
    logs.push(`過去当選者CSV: ${pwFiles.length}ファイル`);
    logs.push(`  除外対象（名前+世帯キー）: ${pwNameHK.size}件`);
    logs.push(`  除外対象（世帯キー）: ${pwHK.size}件`);
  }

  let rows = [...csvData];
  logs.push(`読み込みレコード数: ${rows.length}`);

  rows = rows.map((row) => {
    const dateStr = parseAppDate(row[rMap.datetime]);
    if (!dateStr) return null;
    return { ...row, _appDate: dateStr };
  }).filter(Boolean);

  rows = rows.filter((r) => {
    const pref = (r[rMap.prefecture] || "").trim();
    return prefs.includes(pref);
  });
  logs.push(`都道府県フィルタ後: ${rows.length}`);

  rows = rows.filter((r) => {
    const c = kwMap[r._appDate];
    return c && (r[rMap.keyword] || "").trim() === c;
  });
  logs.push(`キーワード一致後: ${rows.length}`);

  const uLabel = `U${boundary}`;
  const oLabel = `O${boundary + 1}`;

  rows = rows.map((r) => {
    const name = normName(r[rMap.name]);
    const addr = zenkakuToHankaku(r[rMap.address]);
    const bldg = zenkakuToHankaku(r[rMap.building]);
    const birthYear = parseInt(String(r[rMap.birthday] || "").substring(0, 4), 10);
    const age = baseYear - birthYear;
    const email = (r[rMap.email] || "").toLowerCase().trim();
    const hk = buildHKey(r[rMap.zip], r[rMap.address], r[rMap.building]);
    return {
      ...r, _name: name, _address: addr, _building: bldg, _age: age,
      _ageGroup: age <= boundary ? uLabel : oLabel,
      _personKey: email, _householdKey: hk,
    };
  });

  const seen = new Set();
  rows = rows.filter((r) => {
    const k = `${r._appDate}__${r._personKey}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  logs.push(`日別UU化後: ${rows.length}`);

  const before = rows.length;
  rows = rows.filter((r) => {
    const nhk = `${r._name}__${r._householdKey}`;
    return !pwNameHK.has(nhk) && !pwHK.has(r._householdKey);
  });
  if (before - rows.length > 0) {
    logs.push(`過去当選者除外: ${before - rows.length}件除外 → 残${rows.length}`);
  }

  const dates = [...new Set(rows.map((r) => r._appDate))].sort();
  logs.push(`抽選対象日数: ${dates.length}`);
  logs.push("---");

  const rng = mkRng(SEED);
  const wonP = new Set();
  const wonH = new Set();
  const all = [];

  dates.forEach((date) => {
    let day = rows.filter((r) => r._appDate === date);
    day = day.filter((r) => !wonP.has(r._personKey) && !wonH.has(r._householdKey));
    const uPool = day.filter((r) => r._ageGroup === uLabel);
    const oPool = day.filter((r) => r._ageGroup === oLabel);
    const uS = shuffle(uPool, rng);
    const oS = shuffle(oPool, rng);
    let res;
    if (lotteryMode === "combined") {
      const uWinners = uS.slice(0, winU).map((r) => ({ ...r, _result: "当選" }));
      const uWinnerKeys = new Set(uWinners.map((r) => r._personKey));
      const combinedPool = shuffle([...uS.slice(winU), ...oS], rng);
      const combinedWinners = combinedPool.slice(0, winO).map((r) => ({ ...r, _result: "当選" }));
      const combinedWinnerKeys = new Set(combinedWinners.map((r) => r._personKey));
      const uReserves = uS.slice(winU).filter((r) => !combinedWinnerKeys.has(r._personKey)).slice(0, rsvU).map((r) => ({ ...r, _result: "予備" }));
      const reserveKeys = new Set(uReserves.map((r) => r._personKey));
      const combinedReserves = combinedPool.slice(winO).filter((r) => !reserveKeys.has(r._personKey)).slice(0, rsvO).map((r) => ({ ...r, _result: "予備" }));
      res = [...uWinners, ...combinedWinners, ...uReserves, ...combinedReserves];
      logs.push(`${date}: 候補 ${uLabel}=${uPool.length} 全体=${day.length} → 選出${res.length}名`);
    } else {
      res = [
        ...uS.slice(0, winU).map((r) => ({ ...r, _result: "当選" })),
        ...oS.slice(0, winO).map((r) => ({ ...r, _result: "当選" })),
        ...uS.slice(winU, winU + rsvU).map((r) => ({ ...r, _result: "予備" })),
        ...oS.slice(winO, winO + rsvO).map((r) => ({ ...r, _result: "予備" })),
      ];
      logs.push(`${date}: 候補 ${uLabel}=${uPool.length} ${oLabel}=${oPool.length} → 選出${res.length}名`);
    }
    res.forEach((r) => { wonP.add(r._personKey); wonH.add(r._householdKey); });
    all.push(...res);
  });

  logs.push("---");
  logs.push(`総当選者数: ${all.length}`);
  const pc = new Set(); const hc = new Set(); let pd = 0; let hd = 0;
  all.forEach((r) => {
    if (pc.has(r._personKey)) pd++; pc.add(r._personKey);
    if (hc.has(r._householdKey)) hd++; hc.add(r._householdKey);
  });
  logs.push(`同一人物重複: ${pd}`);
  logs.push(`同一世帯重複: ${hd}`);

  return { items: all, logs, rMap, oMap };
}

/* ================================================================
   Component
   ================================================================ */
export default function App() {
  const [step, setStep] = useState(0);
  const [csvData, setCsvData] = useState(null);
  const [csvCols, setCsvCols] = useState([]);
  const [fName, setFName] = useState("");
  const [rMap, setRMap] = useState({});
  const [oMap, setOMap] = useState({});
  const [kws, setKws] = useState(DEFAULT_KW);
  const [lotteryMode, setLotteryMode] = useState("separate");
  const [wU, setWU] = useState(2);
  const [wO, setWO] = useState(3);
  const [rU, setRU] = useState(2);
  const [rO, setRO] = useState(3);
  const [baseY, setBaseY] = useState(2026);
  const [bound, setBound] = useState(49);
  const [prefs, setPrefs] = useState("愛知県,三重県,岐阜県");
  const [result, setResult] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [vErr, setVErr] = useState("");
  const [pwFiles, setPwFiles] = useState([]);
  const fRef = useRef(null);
  const pwRef = useRef(null);

  function onFile(file) {
    if (!file) return;
    setFName(file.name);
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        setCsvData(res.data);
        const f = res.meta.fields || [];
        setCsvCols(f);
        const rm = {}; REQ_COLS.forEach((c) => { rm[c.key] = autoDetect(f, c.hints); }); setRMap(rm);
        const om = {}; OPT_COLS.forEach((c) => { om[c.key] = autoDetect(f, c.hints); }); setOMap(om);
        setStep(1); setVErr("");
      },
    });
  }

  function onPwFile(file) {
    if (!file) return;
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const f = res.meta.fields || [];
        const cm = {};
        PW_COLS.forEach((c) => { cm[c.key] = autoDetect(f, c.hints); });
        setPwFiles((prev) => [...prev, { name: file.name, data: res.data, columns: f, colMap: cm }]);
      },
    });
  }

  function updatePwCol(fi, key, val) {
    setPwFiles((prev) => {
      const u = [...prev];
      u[fi] = { ...u[fi], colMap: { ...u[fi].colMap, [key]: val } };
      return u;
    });
  }

  function addKw() {
    const last = kws.length > 0 ? kws[kws.length - 1].date : "2026-01-01";
    const d = new Date(last); d.setDate(d.getDate() + 1);
    setKws([...kws, { date: d.toISOString().split("T")[0], keyword: "" }]);
  }

  function handleRun() {
    const missing = REQ_COLS.filter((c) => !rMap[c.key]);
    if (missing.length > 0) { setVErr(`必須カラム未設定: ${missing.map((c) => c.label).join(", ")}`); return; }
    if (kws.length === 0) { setVErr("キーワードが1つも設定されていません"); return; }
    for (let i = 0; i < pwFiles.length; i++) {
      const pw = pwFiles[i];
      const mp = PW_COLS.filter((c) => !pw.colMap[c.key]);
      if (mp.length > 0) { setVErr(`過去当選者CSV「${pw.name}」の必須カラム未設定: ${mp.map((c) => c.label).join(", ")}`); return; }
    }
    setVErr(""); setStep(2);
    setTimeout(() => {
      try {
        const prefList = prefs.split(",").map((p) => p.trim()).filter(Boolean);
        const res = runLotteryLogic(csvData, rMap, oMap, kws, prefList, wU, wO, rU, rO, baseY, bound, pwFiles, lotteryMode);
        setResult(res); setLogLines(res.logs); setStep(3);
      } catch (e) {
        setLogLines(["エラーが発生しました: " + e.message]);
        setStep(3); setResult({ items: [], rMap, oMap });
      }
    }, 50);
  }

  function buildResultCsv(items, rm, om) {
    const header = T_COLS.map((c) => c.h);
    const rows = items.map((r) => T_COLS.map((c) => c.fn(r, om, rm)));
    const bom = "\uFEFF";
    return bom + [header, ...rows]
      .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
  }

  function handleDownloadByType(resultType, filename) {
    if (!result || result.items.length === 0) return;
    const { items, rMap: rm, oMap: om } = result;
    const filtered = items.filter((r) => r._result === resultType);
    if (filtered.length === 0) return;
    const csv = buildResultCsv(filtered, rm, om);
    downloadCsvBlob(csv, filename);
  }

  const items = result?.items || [];
  const winnerItems = items.filter((r) => r._result === "当選");
  const reserveItems = items.filter((r) => r._result === "予備");
  const rm = result?.rMap || rMap;
  const om = result?.oMap || oMap;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8e6e1", fontFamily: "'Noto Sans JP','Helvetica Neue',sans-serif" }}>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 20% 0%,rgba(255,107,53,0.06) 0%,transparent 60%),radial-gradient(ellipse at 80% 100%,rgba(53,107,255,0.04) 0%,transparent 60%)" }} />

      <header style={{ padding: "32px 40px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, fontFamily: "'Zen Kaku Gothic New',sans-serif", background: "linear-gradient(135deg,#ff6b35,#f7c948)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>抽選マシン</h1>
          <span style={{ fontSize: 13, color: "#666", letterSpacing: 1 }}>LOTTERY ENGINE</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {["CSV読込","設定","実行","結果"].map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: step >= i ? "linear-gradient(135deg,#ff6b35,#e85d26)" : "rgba(255,255,255,0.06)", color: step >= i ? "#fff" : "#555", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{i + 1}</div>
              <span style={{ fontSize: 12, color: step >= i ? "#ccc" : "#444" }}>{l}</span>
              {i < 3 && <div style={{ width: 32, height: 1, background: step > i ? "#ff6b35" : "rgba(255,255,255,0.08)" }} />}
            </div>
          ))}
        </div>
      </header>

      <main style={{ padding: "32px 40px", maxWidth: 1200, margin: "0 auto", position: "relative" }}>

        {step === 0 && (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f) onFile(f); }}
              onClick={() => fRef.current?.click()}
              style={{ width: 520, padding: "80px 40px", border: `2px dashed ${dragOver ? "#ff6b35" : "rgba(255,255,255,0.12)"}`, borderRadius: 16, background: dragOver ? "rgba(255,107,53,0.04)" : "rgba(255,255,255,0.02)", textAlign: "center", cursor: "pointer" }}
            >
              <div style={{ fontSize: 48, marginBottom: 20, opacity: 0.4 }}>📄</div>
              <p style={{ fontSize: 16, color: "#aaa", margin: "0 0 8px" }}>応募者CSVをドラッグ＆ドロップ</p>
              <p style={{ fontSize: 13, color: "#555" }}>またはクリックして選択</p>
              <input ref={fRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 8, background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.15)", marginBottom: 28, fontSize: 13 }}>
              <span>📄</span>
              <span style={{ color: "#ff6b35", fontWeight: 500 }}>{fName}</span>
              <span style={{ color: "#666" }}>— {csvData?.length?.toLocaleString()} レコード</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
              <div>
                <Sec>抽選モード</Sec>
                <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                  {[
                    { value: "separate", label: `U${bound} / O${bound+1} 別枠` },
                    { value: "combined", label: `U${bound} 固定 + 全体枠` },
                  ].map((m) => (
                    <button key={m.value} onClick={() => setLotteryMode(m.value)} style={{ flex: 1, padding: "8px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer", border: lotteryMode === m.value ? "1px solid #ff6b35" : "1px solid rgba(255,255,255,0.1)", background: lotteryMode === m.value ? "rgba(255,107,53,0.15)" : "rgba(255,255,255,0.03)", color: lotteryMode === m.value ? "#ff6b35" : "#777" }}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <Sec>当選人数</Sec>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
                  <NI label={`U${bound} 当選`} value={wU} onChange={setWU} />
                  <NI label={lotteryMode === "combined" ? "全体 当選" : `O${bound+1} 当選`} value={wO} onChange={setWO} />
                  <NI label={`U${bound} 予備`} value={rU} onChange={setRU} />
                  <NI label={lotteryMode === "combined" ? "全体 予備" : `O${bound+1} 予備`} value={rO} onChange={setRO} />
                </div>
                <Sec>年齢設定</Sec>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
                  <NI label="基準年" value={baseY} onChange={setBaseY} />
                  <NI label="年齢境界 (以下=U)" value={bound} onChange={setBound} />
                </div>
                <Sec>対象都道府県</Sec>
                <input value={prefs} onChange={(e) => setPrefs(e.target.value)} style={si} placeholder="カンマ区切り" />
                <p style={{ fontSize: 11, color: "#555", marginTop: 4 }}>カンマ区切りで複数指定</p>

                <div style={{ marginTop: 24 }}>
                  <Sec>カラムマッピング <span style={{ fontSize: 10, color: "#ff6b35", marginLeft: 8, fontWeight: 400 }}>必須</span></Sec>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {REQ_COLS.map((col) => (
                      <div key={col.key}>
                        <label style={{ fontSize: 10, color: "#666", display: "block", marginBottom: 3 }}>{col.label}</label>
                        <select value={rMap[col.key]||""} onChange={(e) => setRMap({...rMap,[col.key]:e.target.value})} style={ss(!!rMap[col.key])}>
                          <option value="">— 選択 —</option>
                          {csvCols.map((c) => (<option key={c} value={c}>{c}</option>))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 20 }}>
                  <Sec>カラムマッピング <span style={{ fontSize: 10, color: "#888", marginLeft: 8, fontWeight: 400 }}>任意</span></Sec>
                  <p style={{ fontSize: 11, color: "#555", margin: "-4px 0 10px" }}>設定すると出力CSVに含まれます</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {OPT_COLS.map((col) => (
                      <div key={col.key}>
                        <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 3 }}>{col.label}</label>
                        <select value={oMap[col.key]||""} onChange={(e) => setOMap({...oMap,[col.key]:e.target.value})} style={so}>
                          <option value="">— なし —</option>
                          {csvCols.map((c) => (<option key={c} value={c}>{c}</option>))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <Sec>日別キーワード <button onClick={addKw} style={{ marginLeft: 12, padding: "2px 10px", fontSize: 12, background: "rgba(255,107,53,0.15)", color: "#ff6b35", border: "1px solid rgba(255,107,53,0.3)", borderRadius: 4, cursor: "pointer" }}>+ 追加</button></Sec>
                <div style={{ maxHeight: 340, overflowY: "auto", paddingRight: 8 }}>
                  {kws.map((kw, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                      <input type="date" value={kw.date} onChange={(e) => { const u=[...kws]; u[i]={...u[i],date:e.target.value}; setKws(u); }} style={{ padding: "6px 8px", fontSize: 12, width: 150, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#e8e6e1", outline: "none", colorScheme: "dark" }} />
                      <input value={kw.keyword} onChange={(e) => { const u=[...kws]; u[i]={...u[i],keyword:e.target.value}; setKws(u); }} style={{ flex: 1, padding: "6px 8px", fontSize: 13, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#e8e6e1", outline: "none" }} placeholder="キーワード" />
                      <button onClick={() => setKws(kws.filter((_,j) => j!==i))} style={{ width: 24, height: 24, padding: 0, fontSize: 14, background: "none", border: "none", color: "#555", cursor: "pointer" }}>×</button>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 28 }}>
                  <Sec>過去当選者の除外 <button onClick={() => pwRef.current?.click()} style={{ marginLeft: 12, padding: "2px 10px", fontSize: 12, background: "rgba(91,141,239,0.15)", color: "#5b8def", border: "1px solid rgba(91,141,239,0.3)", borderRadius: 4, cursor: "pointer" }}>+ CSV追加</button></Sec>
                  <input ref={pwRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => { onPwFile(e.target.files?.[0]); e.target.value=""; }} />
                  <p style={{ fontSize: 11, color: "#555", margin: "-4px 0 12px" }}>名前＋世帯キーで照合して除外します</p>
                  {pwFiles.length === 0 && (
                    <div style={{ padding: 16, borderRadius: 8, border: "1px dashed rgba(255,255,255,0.08)", textAlign: "center" }}>
                      <p style={{ fontSize: 12, color: "#444", margin: 0 }}>過去当選者CSVなし（任意）</p>
                    </div>
                  )}
                  {pwFiles.map((pw, fi) => (
                    <div key={fi} style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 8, background: "rgba(91,141,239,0.04)", border: "1px solid rgba(91,141,239,0.12)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                          <span style={{ color: "#5b8def" }}>📋</span>
                          <span style={{ color: "#5b8def", fontWeight: 500 }}>{pw.name}</span>
                          <span style={{ color: "#555" }}>({pw.data.length}件)</span>
                        </div>
                        <button onClick={() => setPwFiles(pwFiles.filter((_,j) => j!==fi))} style={{ fontSize: 12, padding: "2px 8px", background: "rgba(255,60,60,0.1)", color: "#ff6b6b", border: "1px solid rgba(255,60,60,0.2)", borderRadius: 4, cursor: "pointer" }}>除去</button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        {PW_COLS.map((col) => (
                          <div key={col.key}>
                            <label style={{ fontSize: 10, color: "#666", display: "block", marginBottom: 2 }}>{col.label}</label>
                            <select value={pw.colMap[col.key]||""} onChange={(e) => updatePwCol(fi,col.key,e.target.value)} style={ss(!!pw.colMap[col.key])}>
                              <option value="">— 選択 —</option>
                              {pw.columns.map((c) => (<option key={c} value={c}>{c}</option>))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {vErr && (<div style={{ marginTop: 20, padding: "10px 16px", borderRadius: 6, background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.25)", color: "#ff6b6b", fontSize: 13 }}>{vErr}</div>)}
            <div style={{ marginTop: 36, textAlign: "center" }}>
              <button onClick={handleRun} style={{ padding: "14px 64px", fontSize: 16, fontWeight: 700, letterSpacing: 1, background: "linear-gradient(135deg,#ff6b35,#e8431f)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", boxShadow: "0 4px 24px rgba(255,107,53,0.3)" }}>抽選開始</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 80 }}>
            <div style={{ width: 300, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden", marginBottom: 16 }}>
              <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg,#ff6b35,#f7c948)", width: "60%", animation: "pulse 1s infinite alternate" }} />
            </div>
            <style>{`@keyframes pulse{from{width:30%}to{width:90%}}`}</style>
            <p style={{ fontSize: 14, color: "#888" }}>抽選処理中...</p>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
              <div style={{ display: "flex", gap: 16 }}>
                <SC label="総当選者" value={items.length} accent="#ff6b35" />
                <SC label="当選" value={items.filter((r) => r._result === "当選").length} accent="#3ecf8e" />
                <SC label="予備" value={items.filter((r) => r._result === "予備").length} accent="#f7c948" />
                <SC label="対象日数" value={[...new Set(items.map((r) => r._appDate))].length} accent="#5b8def" />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {winnerItems.length > 0 && (
                  <button onClick={() => handleDownloadByType("当選", "抽選結果_当選.csv")} style={{ padding: "10px 18px", fontSize: 13, fontWeight: 600, background: "linear-gradient(135deg,#3ecf8e,#2aa56f)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", boxShadow: "0 2px 12px rgba(62,207,142,0.25)", whiteSpace: "nowrap" }}>
                    ⬇ 当選CSV
                  </button>
                )}
                {reserveItems.length > 0 && (
                  <button onClick={() => handleDownloadByType("予備", "抽選結果_予備.csv")} style={{ padding: "10px 18px", fontSize: 13, fontWeight: 600, background: "linear-gradient(135deg,#f7c948,#d8a928)", color: "#1d1d1d", border: "none", borderRadius: 6, cursor: "pointer", boxShadow: "0 2px 12px rgba(247,201,72,0.25)", whiteSpace: "nowrap" }}>
                    ⬇ 予備CSV
                  </button>
                )}
                <button onClick={() => { setStep(1); setResult(null); setLogLines([]); }} style={{ padding: "10px 20px", fontSize: 13, background: "rgba(255,255,255,0.04)", color: "#aaa", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, cursor: "pointer" }}>設定に戻る</button>
                <button onClick={() => { setStep(0); setCsvData(null); setResult(null); setLogLines([]); setFName(""); setPwFiles([]); }} style={{ padding: "10px 20px", fontSize: 13, background: "rgba(255,255,255,0.04)", color: "#aaa", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, cursor: "pointer" }}>最初から</button>
              </div>
            </div>

            <details style={{ marginBottom: 20 }}>
              <summary style={{ fontSize: 13, color: "#888", cursor: "pointer", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>処理ログ</summary>
              <pre style={{ fontSize: 11, color: "#666", lineHeight: 1.7, padding: "12px 16px", background: "rgba(255,255,255,0.02)", borderRadius: 6, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap" }}>{logLines.join("\n")}</pre>
            </details>

            {items.length > 0 && (
              <div style={{ display: "grid", gap: 20 }}>
                <ResultTable title={`当選一覧 (${winnerItems.length}件)`} items={winnerItems} rm={rm} om={om} />
                <ResultTable title={`予備一覧 (${reserveItems.length}件)`} items={reserveItems} rm={rm} om={om} />
              </div>
            )}
            {items.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
                <p>抽選結果がありません。設定を確認してください。</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Sec({ children }) {
  return (<h3 style={{ fontSize: 13, fontWeight: 600, color: "#999", letterSpacing: 0.5, marginBottom: 12, marginTop: 0, display: "flex", alignItems: "center" }}>{children}</h3>);
}

function ResultTable({ title, items, rm, om }) {
  return (
    <section>
      <h3 style={{ fontSize: 14, color: "#bbb", margin: "0 0 10px" }}>{title}</h3>
      {items.length === 0 ? (
        <div style={{ padding: 20, borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", color: "#666", fontSize: 12 }}>
          対象データがありません。
        </div>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", maxHeight: "45vh", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#0d0d14", position: "sticky", top: 0, zIndex: 1 }}>
                {T_COLS.map((c) => (
                  <th key={c.h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 500, color: "#666", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap", background: "#0d0d14" }}>{c.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => {
                const newDay = i === 0 || r._appDate !== items[i - 1]._appDate;
                return (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)", borderTop: newDay && i > 0 ? "2px solid rgba(255,107,53,0.15)" : "none" }}>
                    {T_COLS.map((c, ci) => {
                      const val = c.fn(r, om, rm);
                      const base = { padding: "8px 12px", whiteSpace: "nowrap" };
                      if (c.h === "当選区分") {
                        return (<td key={ci} style={base}><span style={{ padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 600, background: val === "当選" ? "rgba(62,207,142,0.15)" : "rgba(247,201,72,0.15)", color: val === "当選" ? "#3ecf8e" : "#f7c948" }}>{val}</span></td>);
                      }
                      if (c.h === "年齢区分") return (<td key={ci} style={{ ...base, color: String(val).startsWith("U") ? "#5b8def" : "#c084fc" }}>{val}</td>);
                      if (c.h === "名前") return (<td key={ci} style={{ ...base, fontWeight: 500 }}>{val}</td>);
                      if (c.h === "世帯キー") return (<td key={ci} style={{ ...base, fontSize: 10, color: "#555", fontFamily: "monospace" }}>{val}</td>);
                      return (<td key={ci} style={base}>{val || "—"}</td>);
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function NI({ label, value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 3 }}>{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)} style={si} />
    </div>
  );
}

function SC({ label, value, accent }) {
  return (
    <div style={{ padding: "12px 20px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent, fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{label}</div>
    </div>
  );
}