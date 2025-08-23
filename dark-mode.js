(() => {
          'use strict'

          const getStoredTheme = () => localStorage.getItem('theme')
          const setStoredTheme = theme => localStorage.setItem('theme', theme)

          const getPreferredTheme = () => {
            const storedTheme = getStoredTheme()
            if (storedTheme) {
              return storedTheme
            }

            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
          }

          const setTheme = theme => {
            document.documentElement.setAttribute('data-bs-theme', theme)
          }

          setTheme(getPreferredTheme())

          const showActiveTheme = (theme) => {
            const icon = document.querySelector('#theme-toggle i')
            if (theme === 'dark') {
              icon.classList.remove('bi-moon-stars-fill')
              icon.classList.add('bi-sun-fill')
            } else {
              icon.classList.remove('bi-sun-fill')
              icon.classList.add('bi-moon-stars-fill')
            }
          }

          window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            const storedTheme = getStoredTheme()
            if (storedTheme !== 'light' && storedTheme !== 'dark') {
              const preferred = getPreferredTheme()
              setTheme(preferred)
              showActiveTheme(preferred)
            }
          })

          window.addEventListener('DOMContentLoaded', () => {
            showActiveTheme(getPreferredTheme())

            const toggleButton = document.querySelector('#theme-toggle');
            if (toggleButton) {
              toggleButton.addEventListener('click', () => {
                const currentTheme = document.documentElement.getAttribute('data-bs-theme')
                const newTheme = currentTheme === 'dark' ? 'light' : 'dark'
                setStoredTheme(newTheme)
                setTheme(newTheme)
                showActiveTheme(newTheme)
              });
            }
          })
        })()