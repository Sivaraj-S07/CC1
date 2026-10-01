const multer = require("multer");
const { asyncHandler, ApiError } = require("../utils/asyncHandler");
const { buildQuizPdfBuffer, parseQuizPdfBuffer, MAX_PDF_BYTES } = require("../utils/quizPdf");
const { loadQuizClipboard, validateClipboard, buildQuizFromClipboard } = require("./adminQuizCloneController");

/**
 * Export as PDF / Import Quiz from PDF
 * -------------------------------------
 * GET  /api/admin/quizzes/:id/export-pdf -> downloads a full backup PDF
 *                                            (human-readable report + the
 *                                            same clipboard data Copy Quiz
 *                                            uses, embedded inside it).
 * POST /api/admin/quizzes/import-pdf     -> multipart/form-data upload of
 *                                            such a PDF ("file" field);
 *                                            recreates the quiz from it.
 *
 * Both routes delegate the actual snapshot/build logic to
 * adminQuizCloneController so a quiz restored from a PDF is exactly as
 * faithful as one pasted from copied JSON — the PDF is just a different
 * container for the same data.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const looksLikePdf = file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
    if (!looksLikePdf) return cb(new ApiError(400, "Please upload a PDF file."));
    cb(null, true);
  },
});

// Wraps multer so its errors surface as normal ApiError JSON responses
// instead of falling through to the generic 500 handler.
function uploadMiddleware(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    if (err.code === "LIMIT_FILE_SIZE") {
      return next(new ApiError(400, `The PDF is too large (max ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB).`));
    }
    return next(new ApiError(400, err.message || "Failed to read the uploaded file."));
  });
}

function safeFileName(title) {
  const cleaned = String(title || "quiz")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return (cleaned || "quiz").slice(0, 80);
}

// GET /api/admin/quizzes/:id/export-pdf
const exportQuizPdf = asyncHandler(async (req, res) => {
  const { clipboard, quiz } = await loadQuizClipboard(req.params.id);

  const optionCount = clipboard.questions.reduce((n, q) => n + (q.options ? q.options.length : 0), 0);
  const buffer = await buildQuizPdfBuffer(clipboard, {
    generatedAt: new Date().toISOString(),
    rounds: clipboard.rounds.length,
    questions: clipboard.questions.length,
    options: optionCount,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(quiz.title)}-backup.pdf"`);
  res.setHeader("Content-Length", buffer.length);
  // Bypass the app-wide gzip response middleware (which only patches
  // res.send): a PDF is already dense/binary, gains little from gzip, and
  // sending it untouched avoids any risk of a proxy/CDN mishandling a
  // dynamically gzip-encoded binary download.
  res.status(200);
  res.end(buffer);
});

// POST /api/admin/quizzes/import-pdf  (multipart/form-data, field "file")
const importQuizPdf = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    throw new ApiError(400, "No PDF file was uploaded.");
  }

  const clipboard = await parseQuizPdfBuffer(req.file.buffer);
  validateClipboard(clipboard);

  const body = req.body || {};
  const result = await buildQuizFromClipboard(clipboard, {
    title: typeof body.title === "string" ? body.title : undefined,
    password: typeof body.password === "string" ? body.password : undefined,
    keepStatus: body.keepStatus === "true" || body.keepStatus === true,
  });

  res.status(201).json({ success: true, ...result });
});

module.exports = { uploadMiddleware, exportQuizPdf, importQuizPdf };
