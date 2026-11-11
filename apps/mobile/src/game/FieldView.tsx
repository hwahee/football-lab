/**
 * The 3D canvas: an expo-gl surface driven by three.js.
 *
 * three.js expects a DOM canvas; expo-gl hands us a bare WebGL2 context. The
 * renderer only touches a handful of canvas members, so a small shim object
 * stands in for it (the approach react-three-fiber's native renderer takes).
 *
 * The component owns the render loop and nothing else: every frame it asks
 * `getFrame(dt)` what to draw. Game state never passes through React state on
 * its way to the screen, so a running play does not re-render the UI.
 */
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useCallback, useEffect, useRef } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { WebGLRenderer } from 'three';

import { FieldScene, type SceneFrame } from './render/scene';

export type FieldTouchPhase = 'start' | 'move' | 'end';

export interface FieldViewProps {
  testID: string;
  /** Called once per rendered frame with the seconds since the last one. */
  getFrame: (dt: number) => SceneFrame;
  /** Touches, as ground points in world space. Omit to make the field inert. */
  onTouch?: (phase: FieldTouchPhase, world: { x: number; z: number }) => void;
}

/**
 * The app compiles without the DOM lib, so the WebGL members the context
 * inherits are invisible to TypeScript; these are the two this file reads.
 */
type FieldGL = ExpoWebGLRenderingContext & {
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
};

function createRenderer(gl: FieldGL): WebGLRenderer {
  const canvas = {
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    clientWidth: gl.drawingBufferWidth,
    clientHeight: gl.drawingBufferHeight,
    style: {},
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getContext: () => gl,
  };
  const renderer = new WebGLRenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    context: gl,
    antialias: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, false);
  return renderer;
}

export function FieldView({ testID, getFrame, onTouch }: FieldViewProps) {
  const sceneRef = useRef<FieldScene | null>(null);
  const frameRequest = useRef<number | null>(null);
  const size = useRef({ width: 1, height: 1 });
  // The loop outlives renders: it always calls the latest callback.
  const getFrameRef = useRef(getFrame);
  useEffect(() => {
    getFrameRef.current = getFrame;
  });

  useEffect(
    () => () => {
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
    },
    [],
  );

  const onContextCreate = useCallback((context: ExpoWebGLRenderingContext) => {
    const gl = context as FieldGL;
    const renderer = createRenderer(gl);
    const scene = new FieldScene();
    sceneRef.current = scene;
    let bufferWidth = 0;
    let bufferHeight = 0;
    let last = Date.now();

    const loop = () => {
      frameRequest.current = requestAnimationFrame(loop);
      const now = Date.now();
      // Clamp: after a pause (app in background) the play must not jump ahead.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (gl.drawingBufferWidth !== bufferWidth || gl.drawingBufferHeight !== bufferHeight) {
        bufferWidth = gl.drawingBufferWidth;
        bufferHeight = gl.drawingBufferHeight;
        renderer.setSize(bufferWidth, bufferHeight, false);
        scene.setViewport(bufferWidth, bufferHeight);
      }
      scene.update(getFrameRef.current(dt), dt);
      scene.render(renderer);
      gl.endFrameEXP();
    };
    if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
    loop();
  }, []);

  const onLayout = (event: LayoutChangeEvent) => {
    size.current = event.nativeEvent.layout;
  };

  const touch = (phase: FieldTouchPhase, event: GestureResponderEvent) => {
    const scene = sceneRef.current;
    if (!scene || !onTouch) return;
    const { locationX, locationY } = event.nativeEvent;
    onTouch(
      phase,
      scene.viewToWorld(
        locationX / Math.max(1, size.current.width),
        locationY / Math.max(1, size.current.height),
      ),
    );
  };

  return (
    <View
      testID={testID}
      style={{ flex: 1 }}
      onLayout={onLayout}
      onStartShouldSetResponder={() => onTouch !== undefined}
      onMoveShouldSetResponder={() => onTouch !== undefined}
      onResponderGrant={(event) => touch('start', event)}
      onResponderMove={(event) => touch('move', event)}
      onResponderRelease={(event) => touch('end', event)}
      onResponderTerminate={(event) => touch('end', event)}
    >
      {/* The GL surface must not swallow the touches the wrapper handles. */}
      <View style={{ flex: 1 }} pointerEvents="none">
        <GLView style={{ flex: 1 }} msaaSamples={4} onContextCreate={onContextCreate} />
      </View>
    </View>
  );
}
