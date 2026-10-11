// Working hours. Nobody works between 22:00 and 06:00 Prague time, wherever the server runs.
export const OPENS = 6
export const CLOSES = 22
export const ZONE = 'Europe/Prague'

const format = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false })

export function clock(date = new Date()) {
  const [hour, minute] = format.format(date).split(':').map(Number)
  return { hour: hour % 24, minute }
}

export const isOpen = (date = new Date()) => {
  const { hour } = clock(date)
  return hour >= OPENS && hour < CLOSES
}
