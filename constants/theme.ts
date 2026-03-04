/**
 * 温かみのあるパステル調テーマ（クリーム・淡いオレンジ・ピンク・コーラル系）
 */

import { Platform } from 'react-native';

const tintColorLight = '#c97b63';
const tintColorDark = '#e8a090';

export const Colors = {
  light: {
    text: '#3d3836',
    background: '#fefaf6',
    tint: tintColorLight,
    icon: '#8b7355',
    tabIconDefault: '#b0a090',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#f5ebe6',
    background: '#2a2522',
    tint: tintColorDark,
    icon: '#c4b5a8',
    tabIconDefault: '#9a8c7d',
    tabIconSelected: tintColorDark,
  },
};

/** パステル系UI用（アプリ全体で共通） */
export const Pastel = {
  cream: '#fefaf6',
  creamDark: '#f5ebe0',
  coral: '#e8a090',
  coralStrong: '#c97b63',
  peach: '#f4c4a8',
  pink: '#f0d0c8',
  orange: '#e8b89a',
  cardFront: '#fff9f5',
  cardBack: '#fdf3ed',
  shadow: '#d4c4b8',
  success: '#7cb342',
  error: '#c75c5c',
  borderRadius: 20,
  borderRadiusButton: 18,
  shadowStyle: {
    shadowColor: '#c4a898',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
