const Signal = require('../models/Signal');

async function getSignals(req, res) {
  const filter = { user: req.user._id };
  if (req.query.category) filter.category = req.query.category;
  const signals = await Signal.find(filter).sort({ createdAt: -1 });
  res.json({ signals });
}

async function createSignal(req, res) {
  const { category, title, description, source, score } = req.body;
  if (!category || !title) {
    return res.status(400).json({ message: 'Category and title are required' });
  }
  const signal = await Signal.create({
    user: req.user._id,
    category,
    title,
    description,
    source,
    score,
  });
  res.status(201).json({ signal });
}

async function updateSignal(req, res) {
  const signal = await Signal.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    req.body,
    { new: true, runValidators: true }
  );
  if (!signal) return res.status(404).json({ message: 'Signal not found' });
  res.json({ signal });
}

async function deleteSignal(req, res) {
  const signal = await Signal.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!signal) return res.status(404).json({ message: 'Signal not found' });
  res.json({ message: 'Signal deleted' });
}

module.exports = { getSignals, createSignal, updateSignal, deleteSignal };
