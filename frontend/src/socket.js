import { io } from 'socket.io-client'

const URL = import.meta.env.VITE_BACKEND_URL || ''
const socket = io(URL, { path: '/ws', transports: ['websocket', 'polling'] })
export default socket
