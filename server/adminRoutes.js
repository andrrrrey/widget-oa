import multer from "multer";
// server/adminRoutes.js
//import express from "express";
//import multer from "multer";
//import fs from "fs";
//import OpenAI from "openai";

import 'dotenv/config';               // <— ДОЛЖНО быть первой строкой
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import adminRoutes from './adminRoutes.js';

const router = express.Router();
const upload = multer({ dest: "/tmp", limits: { fileSize: 25 * 1024 * 1024 } });

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------- helpers ---------- */

function getVS() {
  const VS = client?.beta?.vectorStores ?? client.vectorStores;
  if (!VS) throw new Error("OpenAI SDK слишком старый: нет vectorStores. Обновите: npm i openai@latest");
  return VS;
}

async function toOpenAIFile(stream, filename) {
  if (OpenAI?.toFile) return await OpenAI.toFile(stream, filename);
  try {
    const uploads = await import("openai/uploads");
    if (uploads?.toFile) return await uploads.toFile(stream, filename);
  } catch {}
  throw new Error("Ваш 'openai' слишком старый и не содержит toFile(). Обновите: npm i openai@latest");
}

async function ensureVectorStore() {
  const VS = getVS();
  let id = process.env.VECTOR_STORE_ID;
  if (id) return id;

  const vs = await VS.create({ name: "company-knowledge" });
  id = vs.id;
  process.env.VECTOR_STORE_ID = id;

  try {
    const envPath = "/opt/widget-oa/.env";
    const txt = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    if (!/^\s*VECTOR_STORE_ID=/.test(txt)) fs.appendFileSync(envPath, `\nVECTOR_STORE_ID=${id}\n`);
  } catch {}
  return id;
}

async function retrieveVSFile(VS, vsId, vsfileId) {
  try { return await VS.files.retrieve(vsId, vsfileId); } catch {}
  try { return await VS.files.get(vsId,   vsfileId);   } catch {}
  return null;
}

function toArrayList(raw) {
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw)) return raw;
  return [];
}

const isFileId   = (s) => typeof s === "string" && /^file[_-]/.test(s);
const isVSFileId = (s) => typeof s === "string" && /^vsfile[_-]/.test(s);

/* ============== SETTINGS ============== */

router.get("/settings", async (_req, res) => {
  try {
    const asstAPI = client?.beta?.assistants ?? client.assistants;
    const a = await asstAPI.retrieve(process.env.ASSISTANT_ID);
    res.json({
      instructions: a.instructions || "",
      model: a.model || undefined,
      tools: a.tools || undefined,
    });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || "settings error" });
  }
});

router.put("/settings", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const instructions = String(req.body?.instructions ?? "");
    const vsId = await ensureVectorStore();
    const asstAPI = client?.beta?.assistants ?? client.assistants;

    const payload = { instructions };
    if (client?.beta?.assistants && (client?.beta?.vectorStores ?? client.vectorStores)) {
      payload.tools = [{ type: "file_search" }];
      payload.tool_resources = { file_search: { vector_store_ids: [vsId] } };
    }

    await asstAPI.update(process.env.ASSISTANT_ID, payload);
    res.json({ ok: true, vector_store_id: vsId });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || "settings update error" });
  }
});

/* ============== FILES: LIST ============== */

router.get("/files", async (_req, res) => {
  try {
    const vsId = await ensureVectorStore();
    const VS = getVS();

    const raw = await VS.files.list(vsId, { limit: 100 });
    const rows = toArrayList(raw);
    console.log("[FILES/LIST] vector_store:", vsId, "count:", rows.length);

    const norm = await Promise.all(rows.map(async (row, idx) => {
      try {
        // НОВОЕ: у тебя row.id = "file-...", это и есть fileId
        const fileId = isFileId(row?.id) ? row.id
                     : isFileId(row?.file_id) ? row.file_id
                     : isFileId(row?.file?.id) ? row.file.id
                     : null;

        // имя файла
        let filename = row?.filename || null;
        if (!filename && fileId) {
          try { const meta = await client.files.retrieve(fileId); filename = meta?.filename || null; } catch {}
        }
        if (!filename) filename = fileId || (typeof row?.id === "string" ? row.id : `row_${idx}`);

        // Для UI: отдаём id = fileId (т.к. delete работает по fileId)
        const idForUI = fileId || (typeof row?.id === "string" ? row.id : `row_${idx}`);

        return {
          id: idForUI,              // <-- file-*
          filename,
          name: filename,
          created_at: row.created_at,
          status: row.status || "ready",
          usage_bytes: row.usage_bytes,
          last_error: row.last_error || null,
          file_id: fileId,          // явным полем
          vsfile_id: null,          // в твоей версии SDK их нет
          vector_store_id: vsId,
        };
      } catch (e) {
        console.warn("[FILES/LIST] row normalize error:", e?.message);
        return null;
      }
    }));

    res.json({ vector_store_id: vsId, data: norm.filter(Boolean) });
  } catch (e) {
    console.error("[FILES/LIST] error:", e?.status, e?.message);
    res.status(e?.status || 500).json({ error: e?.message || "files list error" });
  }
});

/* ============== FILES: UPLOAD ============== */

router.post("/files", upload.array("files"), async (req, res) => {
  try {
    const vsId = await ensureVectorStore();
    const VS = getVS();

    const arr = req.files || [];
    if (!arr.length) return res.status(400).json({ error: "No files" });

    console.log("[UPLOAD] vectorStore:", vsId);
    console.log("[UPLOAD] files:", arr.map(f => ({
      fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype, size: f.size, path: f.path
    })));

    const filesForBatch = await Promise.all(
      arr.map(f => toOpenAIFile(fs.createReadStream(f.path), f.originalname || "upload.bin"))
    );

    if (!VS?.fileBatches?.uploadAndPoll) {
      return res.status(500).json({ error: "SDK doesn't support fileBatches.uploadAndPoll. Обновите 'openai'." });
    }

    const batch = await VS.fileBatches.uploadAndPoll(vsId, { files: filesForBatch });

    arr.forEach(f => fs.unlink(f.path, () => {}));

    const counts = batch?.file_counts || batch?.counts || undefined;
    console.log("[UPLOAD] batch:", { id: batch?.id, status: batch?.status, file_counts: counts });

    res.json({ ok: true, vector_store_id: vsId, status: batch.status, counts });
  } catch (e) {
    console.error("[UPLOAD ERROR] status:", e?.status);
    console.error("[UPLOAD ERROR] message:", e?.message);
    try { console.error("[UPLOAD ERROR] data:", JSON.stringify(e?.response?.data)); } catch {}
    res.status(e?.status || 500).json({ error: e?.message || "upload error" });
  } finally {
    try { (req.files || []).forEach(f => fs.unlink(f.path, () => {})); } catch {}
  }
});

/* ============== FILES: DELETE ============== */
router.delete("/files/:id", async (req, res) => {
  try {
    const rawParam = String(req.params.id || "");
    const idParam  = decodeURIComponent(rawParam).trim();

    const VS   = getVS();
    const vsId = await ensureVectorStore();

    console.log("[DELETE] vsId:", vsId);
    console.log("[DELETE] idParam raw:", rawParam, "| decoded:", idParam);

    // Определяем fileId (поддержим file_* и vsfile_*)
    let fileId = null;

    const isFileId = (s) => typeof s === "string" && /^file[_-]/.test(s);
    const isVSFileId = (s) => typeof s === "string" && /^vsfile[_-]/.test(s);

    if (isFileId(idParam)) {
      fileId = idParam;
    } else if (isVSFileId(idParam)) {
      // Если пришёл vsfile_*, пробуем достать привязанный file_id
      const det =
        (await VS.files.retrieve(vsId, idParam).catch(() => null)) ||
        (await VS.files.get?.(vsId, idParam).catch(() => null));
      fileId = det?.file_id || det?.file?.id || null;
      if (!isFileId(fileId)) {
        return res.status(404).json({ error: "Не нашли file_id для vsfile_*" });
      }
    } else {
      // Дали имя файла — найдём его fileId по списку
      const raw = await VS.files.list(vsId, { limit: 100 }).catch(() => null);
      const rows = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
      for (const r of rows) {
        const rFileId = r?.id && /^file[_-]/.test(r.id) ? r.id
                      : r?.file_id && /^file[_-]/.test(r.file_id) ? r.file_id
                      : r?.file?.id && /^file[_-]/.test(r.file?.id) ? r.file.id
                      : null;
        if (!rFileId) continue;
        let rName = r?.filename || null;
        if (!rName) {
          try {
            const meta = await client.files.retrieve(rFileId);
            rName = meta?.filename || null;
          } catch {}
        }
        if (rName === idParam) { fileId = rFileId; break; }
      }
      if (!fileId) return res.status(400).json({ error: "Нужен file_* или точное имя файла" });
    }

    console.log("[DELETE] resolved fileId:", fileId);

    // КЛЮЧЕВОЕ: современная сигнатура SDK
    try {
      await VS.files.delete(fileId, { vector_store_id: vsId });
    } catch (e1) {
      console.warn("[DELETE] new-signature failed:", e1?.message);
      // Фолбэки для старых SDK (вдруг пригодится)
      if (VS.files.del) {
        await VS.files.del(vsId, fileId);
      } else if (VS.files.delete.length === 2) {
        await VS.files.delete(vsId, fileId);
      } else {
        throw e1;
      }
    }

    // Необязательно, но попробуем убрать файл из Files API
    try { await client.files.del(fileId); } catch (e) {
      console.warn("[DELETE] files.del warn:", e?.message);
    }

    res.json({ ok: true, file_id: fileId });
  } catch (e) {
    console.error("[DELETE ERROR]", e);
    res.status(e?.status || 500).json({ error: e?.message || "delete error" });
  }
});

export default router;
