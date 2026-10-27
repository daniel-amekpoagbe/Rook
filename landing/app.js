const meta = document.querySelector('meta[name="rook-app-url"]')
const note = document.getElementById('launch-note')
const launches = Array.from(document.querySelectorAll('[data-launch]'))

const raw = (meta?.getAttribute('content') ?? '').trim()
const configured = raw.length > 0 && raw !== '__ROOK_APP_URL__'

if (configured) {
  let url
  try {
    url = new URL(raw)
  } catch {
    url = null
  }

  if (url && (url.protocol === 'https:' || url.protocol === 'http:')) {
    for (const link of launches) {
      link.setAttribute('href', url.toString())
    }
  } else {
    disableLaunches()
  }
} else {
  disableLaunches()
}

function disableLaunches() {
  for (const link of launches) {
    link.setAttribute('href', '#')
    link.setAttribute('aria-disabled', 'true')
    link.classList.add('is-disabled')
    link.addEventListener('click', (event) => event.preventDefault())
  }

  if (note) {
    note.textContent = 'The hosted app is being deployed. Check back shortly.'
  }
}
