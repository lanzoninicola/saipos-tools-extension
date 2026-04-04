import { useState, useEffect } from 'react'
import { getSettings, type Settings } from '../storage'

interface UseSettingsReturn {
  settings: Settings | null
  loaded: boolean
  hasConfig: boolean
  setSettings: React.Dispatch<React.SetStateAction<Settings | null>>
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s)
      setLoaded(true)
    })
  }, [])

  const hasConfig = !!(settings?.endpoint && settings?.apiKey)

  return { settings, loaded, hasConfig, setSettings }
}
