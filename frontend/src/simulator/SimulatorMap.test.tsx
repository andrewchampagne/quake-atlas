import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SimulatorMap from './SimulatorMap';

const camera = vi.hoisted(() => ({ initialViewState: undefined as { latitude: number; longitude: number } | undefined, onClick: undefined as ((info: { coordinate: number[] }) => void) | undefined }));
vi.mock('@deck.gl/react', () => ({
  default: (props: { initialViewState: { latitude: number; longitude: number }; onClick: (info: { coordinate: number[] }) => void }) => {
    camera.initialViewState = props.initialViewState;
    camera.onClick = props.onClick;
    return <div data-testid="deck" />;
  },
}));
vi.mock('react-map-gl/maplibre', () => ({ Map: () => null }));
vi.mock('../lib/maplibre', () => ({ maplibregl: {} }));

afterEach(cleanup);

describe('SimulatorMap camera', () => {
  it('re-centers on changed coordinates and preserves the camera object across unrelated renders', () => {
    const onPlace = vi.fn();
    const { rerender } = render(<SimulatorMap location={{ latitude: 35, longitude: 139 }} result={null} onPlace={onPlace} />);
    const first = camera.initialViewState;
    rerender(<SimulatorMap location={{ latitude: 35, longitude: 139 }} result={null} onPlace={onPlace} />);
    expect(camera.initialViewState).toBe(first);
    rerender(<SimulatorMap location={{ latitude: 41, longitude: 29 }} result={null} onPlace={onPlace} />);
    expect(camera.initialViewState).not.toBe(first);
    expect(camera.initialViewState).toMatchObject({ latitude: 41, longitude: 29 });
  });

  it('normalizes repeated-world clicks and supports invalid coordinate editing without a marker', () => {
    const onPlace = vi.fn();
    render(<SimulatorMap location={null} result={null} onPlace={onPlace} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Center on epicenter' }).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('deck'));
    camera.onClick?.({ coordinate: [540.1, 12.34567] });
    expect(onPlace).toHaveBeenCalledWith(12.3457, -179.9);
  });
});
