import { ref, watch, onMounted } from 'vue'

export type Theme = 'light' | 'dark'

export function useTheme() {
  const theme = ref<Theme>('light')

  const toggleTheme = () => {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
  }

  const setTheme = (newTheme: Theme) => {
    theme.value = newTheme
  }

  watch(theme, (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('xiaozhi-theme', newTheme)
  })

  onMounted(() => {
    const savedTheme = localStorage.getItem('xiaozhi-theme') as Theme | null
    if (savedTheme) {
      theme.value = savedTheme
    }
    document.documentElement.setAttribute('data-theme', theme.value)
  })

  return {
    theme,
    toggleTheme,
    setTheme
  }
}
