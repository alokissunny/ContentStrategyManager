const WeeklyRoute = require('../models/WeeklyRoute');

async function getCurrentRoute(req, res) {
  const route = await WeeklyRoute.findOne({ user: req.user._id })
    .sort({ weekOf: -1 })
    .populate('items.signal');
  res.json({ route });
}

async function getRoutes(req, res) {
  const routes = await WeeklyRoute.find({ user: req.user._id }).sort({ weekOf: -1 });
  res.json({ routes });
}

async function createRoute(req, res) {
  const { weekOf, items, performance } = req.body;
  if (!weekOf) {
    return res.status(400).json({ message: 'weekOf is required' });
  }
  const route = await WeeklyRoute.create({
    user: req.user._id,
    weekOf,
    items: items || [],
    performance,
  });
  res.status(201).json({ route });
}

async function updateRoute(req, res) {
  const route = await WeeklyRoute.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    req.body,
    { new: true, runValidators: true }
  );
  if (!route) return res.status(404).json({ message: 'Route not found' });
  res.json({ route });
}

module.exports = { getCurrentRoute, getRoutes, createRoute, updateRoute };
