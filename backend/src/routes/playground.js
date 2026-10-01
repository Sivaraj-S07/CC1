const express = require("express");
const rateLimit = require("express-rate-limit");
const playgroundController = require("../controllers/playgroundController");

const router = express.Router();

// Sandboxed execution is the most expensive endpoint in the app, and this one
// is public, so it gets a tighter budget than the in-quiz judge.
const runLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

router.get("/languages", playgroundController.listLanguages);
router.post("/run", runLimiter, playgroundController.runSnippet);

module.exports = router;
