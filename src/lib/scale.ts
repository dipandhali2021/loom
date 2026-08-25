import { useWindowDimensions } from 'react-native';
import { BASE_WIDTH } from '../theme/tokens';

/**
 * Some frames in the design are laid out by absolute coordinates on the 393pt
 * canvas (the voice screens). This returns the factor to map those coordinates
 * onto the running device's width so the composition stays proportional.
 */
export function useDesignScale() {
  const { width } = useWindowDimensions();
  return width / BASE_WIDTH;
}
