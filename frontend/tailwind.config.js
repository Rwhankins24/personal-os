/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        work: {
          light: '#E6F1FB',
          DEFAULT: '#185FA5',
          dark: '#0C447C',
        },
        personal: {
          light: '#EAF3DE',
          DEFAULT: '#3B6D11',
          dark: '#27500A',
        },
        other: {
          light: '#FAEEDA',
          DEFAULT: '#854F0B',
          dark: '#633806',
        }
      }
    },
  },
  plugins: [],
}
