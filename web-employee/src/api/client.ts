import axios from 'axios'

const defaultBase = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8000'
const baseURL = import.meta.env.VITE_API_BASE_URL ?? defaultBase

export const apiClient = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
})
