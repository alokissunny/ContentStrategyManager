import axios from 'axios';

function resolveBaseURL() {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (!configured) return '/api';
  const normalized = configured.replace(/\/$/, '');
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}

const client = axios.create({
  baseURL: resolveBaseURL(),
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('widesignals_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;
