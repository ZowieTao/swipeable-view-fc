import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMount } from 'react-use';

// We can only have one node at the time claiming ownership for handling the swipe.
// Otherwise, the UX would be confusing.
// That's why we use a singleton here.
let nodeWhoClaimedTheScroll = null;

const axisProperties = {
  root: {
    x: {
      overflowX: 'hidden',
    },
    'x-reverse': {
      overflowX: 'hidden',
    },
    y: {
      overflowY: 'hidden',
    },
    'y-reverse': {
      overflowY: 'hidden',
    },
  },
  flexDirection: {
    x: 'row',
    'x-reverse': 'row-reverse',
    y: 'column',
    'y-reverse': 'column-reverse',
  },
  transform: {
    x: (translate) => `translate(${-translate}%, 0)`,
    'x-reverse': (translate) => `translate(${translate}%, 0)`,
    y: (translate) => `translate(0, ${-translate}%)`,
    'y-reverse': (translate) => `translate(0, ${translate}%)`,
  },
  length: {
    x: 'width',
    'x-reverse': 'width',
    y: 'height',
    'y-reverse': 'height',
  },
  rotationMatrix: {
    x: {
      x: [1, 0],
      y: [0, 1],
    },
    'x-reverse': {
      x: [-1, 0],
      y: [0, 1],
    },
    y: {
      x: [0, 1],
      y: [1, 0],
    },
    'y-reverse': {
      x: [0, -1],
      y: [1, 0],
    },
  },
  scrollPosition: {
    x: 'scrollLeft',
    'x-reverse': 'scrollLeft',
    y: 'scrollTop',
    'y-reverse': 'scrollTop',
  },
  scrollLength: {
    x: 'scrollWidth',
    'x-reverse': 'scrollWidth',
    y: 'scrollHeight',
    'y-reverse': 'scrollHeight',
  },
  clientLength: {
    x: 'clientWidth',
    'x-reverse': 'clientWidth',
    y: 'clientHeight',
    'y-reverse': 'clientHeight',
  },
};

type ListenerReturnType = {
  remove(): void;
};
function addEventListener(node, event, handler, options?): ListenerReturnType {
  node.addEventListener(event, handler, options);
  return {
    remove() {
      node.removeEventListener(event, handler, options);
    },
  };
}

// We are using a 2x2 rotation matrix.
function applyRotationMatrix(touch, axis) {
  const rotationMatrix = axisProperties.rotationMatrix[axis];

  return {
    pageX: rotationMatrix.x[0] * touch.pageX + rotationMatrix.x[1] * touch.pageY,
    pageY: rotationMatrix.y[0] * touch.pageX + rotationMatrix.y[1] * touch.pageY,
  };
}

function SwipeableViews({ children, ...rest }) {
  return <div> {children} </div>;
}

type OnChangeIndexCallback = (indexNew: number, indexLatest, opt: { reason: string }) => void;
type OnSwitchingCallback = (indexNew: number, event: string) => void;
type SpringConfig = {
  duration: string | number;
  easeFunction: string;
  delay: string | number;
};

type SwipeableComponentProps = {
  action?: (actions: { updateHeight: () => void }) => void;
  animateHeight?: boolean;
  animateTransitions?: boolean;
  axis?: 'x' | 'x-reverse' | 'y' | 'y-reverse';
  children: React.ReactNode;
  containerStyle?: React.CSSProperties;
  disabled?: boolean;
  disableLazyLoading?: boolean;
  enableMouseEvents?: boolean;
  hysteresis?: number;
  ignoreNativeScroll?: boolean;
  index?: number;
  onChangeIndex?: OnChangeIndexCallback;
  onMouseDown?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseMove?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseUp?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
  onSwitching?: OnSwitchingCallback;
  onTouchEnd?: (event: React.TouchEvent<HTMLDivElement>) => void;
  onTouchMove?: (event: React.TouchEvent<HTMLDivElement>) => void;
  onTouchStart?: (event: React.TouchEvent<HTMLDivElement>) => void;
  onTransitionEnd?: () => void;
  resistance?: boolean;
  slideClassName?: string;
  slideStyle?: React.CSSProperties;
  springConfig?: SpringConfig;
  style?: React.CSSProperties;
  threshold?: number;
};

const SwipeableComponent: React.FC<SwipeableComponentProps> = ({
  action,
  animateHeight = false,
  animateTransitions = true,
  axis = 'x',
  children,
  containerStyle,
  disabled = false,
  disableLazyLoading = false,
  enableMouseEvents = false,
  hysteresis = 0.6,
  ignoreNativeScroll = false,
  index = 0,
  onChangeIndex,
  onMouseDown,
  onMouseLeave,
  onMouseMove,
  onMouseUp,
  onScroll,
  onSwitching,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  onTransitionEnd,
  resistance = false,
  slideClassName,
  slideStyle,
  springConfig = {
    duration: '0.35s',
    easeFunction: 'cubic-bezier(0.15, 0.3, 0.25, 1)',
    delay: '0s',
  },
  style,
  threshold = 5,
}: SwipeableComponentProps) => {
  const [indexLatest, setIndexLatest] = useState(index);
  // Set to true as soon as the component is swiping.
  // It's the state counter part of this.isSwiping.
  const [isDragging, setIsDragging] = useState(false);
  // Help with SSR logic and lazy loading logic.
  const [renderOnlyActive, setRenderOnlyActive] = useState(disableLazyLoading);
  // Let the render method that we are going to display the same slide than previously.
  const [displaySameSlide, setDisplaySameSlide] = useState(true);

  const indexCurrent = useRef<number | null>(null);
  const containerNode = useRef<HTMLElement>(null);
  const started = useRef<boolean>(false);
  const rootNode = useRef<HTMLElement>(null);

  const transitionListener = useRef<null | ListenerReturnType>(null);
  const touchMoveListener = useRef<null | ListenerReturnType>(null);

  const viewLength = useRef<number | null>(0);
  const lastX = useRef<number | null>(0);
  const vx = useRef<number | null>(0);
  const startX = useRef<number | null>(0);
  const startY = useRef<number | null>(0);
  const isSwiping = useRef<number | undefined>();
  const startIndex = useRef<number | null>(0);

  const handleTransitionEnd = useCallback(() => {
    if (!onTransitionEnd) {
      return;
    }

    // Filters out when changing the children
    if (displaySameSlide) {
      return;
    }

    // The rest callback is triggered when swiping. It's just noise.
    // We filter it out.
    if (!isDragging) {
      onTransitionEnd();
    }
  }, [displaySameSlide, isDragging, onTransitionEnd]);

  const handleSwipeStart = useCallback(
    (event) => {
      const touch = applyRotationMatrix(event.touches[0], axis);

      viewLength.current = rootNode?.current?.getBoundingClientRect()[axisProperties.length[axis]];
      startX.current = touch.pageX;
      lastX.current = touch.pageX;
      vx.current = 0;
      startY.current = touch.pageY;
      isSwiping.current = undefined;
      started.current = true;

      const computedStyle = window.getComputedStyle(containerNode.current!);
      const transform =
        computedStyle.getPropertyValue('-webkit-transform') || computedStyle.getPropertyValue('transform');

      if (transform && transform !== 'none') {
        const transformValues = transform.split('(')[1].split(')')[0].split(',');
        const rootStyle = window.getComputedStyle(rootNode.current!);

        const tranformNormalized = applyRotationMatrix(
          {
            pageX: parseInt(transformValues[4], 10),
            pageY: parseInt(transformValues[5], 10),
          },
          axis,
        );

        startIndex.current =
          -tranformNormalized.pageX /
            (viewLength.current! - parseInt(rootStyle.paddingLeft, 10) - parseInt(rootStyle.paddingRight, 10)) || 0;
      }
    },
    [axis],
  );

  const handleTouchStart = useCallback(
    (event) => {
      if (onTouchStart) {
        onTouchStart(event);
      }
      handleSwipeStart(event);
    },
    [onTouchStart],
  );

  const handleSwipeMove = useCallback((event) => {
    // The touch start event can be cancel.
    // Makes sure we set a starting point.
    if (!started.current) {
      handleTouchStart(event);
      return;
    }

    // We are not supposed to hanlde this touch move.
    if (nodeWhoClaimedTheScroll !== null && nodeWhoClaimedTheScroll !== rootNode.current) {
      return;
    }

    const touch = applyRotationMatrix(event.touches[0], axis);

    // We don't know yet.
    if (isSwiping.current === undefined) {
      const dx = Math.abs(touch.pageX - startX.current!);
      const dy = Math.abs(touch.pageY - startY.current!);

      const _isSwiping = dx > dy && dx > constant.UNCERTAINTY_THRESHOLD;

      // We let the parent handle the scroll.
      if (
        !resistance &&
        (axis === 'y' || axis === 'y-reverse') &&
        ((this.indexCurrent === 0 && this.startX < touch.pageX) ||
          (this.indexCurrent === React.Children.count(this.props.children) - 1 && this.startX > touch.pageX))
      ) {
        this.isSwiping = false;
        return;
      }

      // We are likely to be swiping, let's prevent the scroll event.
      if (dx > dy) {
        event.preventDefault();
      }

      if (isSwiping === true || dy > constant.UNCERTAINTY_THRESHOLD) {
        this.isSwiping = isSwiping;
        this.startX = touch.pageX; // Shift the starting point.

        return; // Let's wait the next touch event to move something.
      }
    }

    if (Boolean(isSwiping.current) !== true) {
      return;
    }

    // We are swiping, let's prevent the scroll event.
    event.preventDefault();

    // Low Pass filter.
    this.vx = this.vx * 0.5 + (touch.pageX - this.lastX) * 0.5;
    this.lastX = touch.pageX;

    const { index, startX } = computeIndex({
      children,
      resistance,
      pageX: touch.pageX,
      startIndex: this.startIndex,
      startX: this.startX,
      viewLength: this.viewLength,
    });

    // Add support for native scroll elements.
    if (nodeWhoClaimedTheScroll === null && !ignoreNativeScroll) {
      const domTreeShapes = getDomTreeShapes(event.target, this.rootNode);
      const hasFoundNativeHandler = findNativeHandler({
        domTreeShapes,
        startX: this.startX,
        pageX: touch.pageX,
        axis,
      });

      // We abort the touch move handler.
      if (hasFoundNativeHandler) {
        return;
      }
    }

    // We are moving toward the edges.
    if (startX) {
      this.startX = startX;
    } else if (nodeWhoClaimedTheScroll === null) {
      nodeWhoClaimedTheScroll = this.rootNode;
    }

    this.setIndexCurrent(index);

    const callback = () => {
      if (onSwitching) {
        onSwitching(index, 'move');
      }
    };

    if (this.state.displaySameSlide || !this.state.isDragging) {
      this.setState(
        {
          displaySameSlide: false,
          isDragging: true,
        },
        callback,
      );
    }

    callback();
  }, []);

  const setIndexCurrent = useCallback(
    (_indexCurrent: number) => {
      if (!animateTransitions && indexCurrent.current !== _indexCurrent) {
        handleTransitionEnd();
      }

      indexCurrent.current = _indexCurrent;

      if (containerNode.current) {
        const transform = axisProperties.transform[axis](_indexCurrent * 100);
        containerNode.current.style.webkitTransform = transform;
        containerNode.current.style.transform = transform;
      }
    },
    [animateTransitions, axis, handleTransitionEnd],
  );

  useMount(() => {
    if (process.env.NODE_ENV !== 'production') {
      checkIndexBounds({ index, children });
    }
    setIndexCurrent(index);
  });

  useEffect(() => {
    // Subscribe to transition end events.
    transitionListener.current = addEventListener(containerNode, 'transitionend', (event) => {
      if (event.target !== containerNode) {
        return;
      }

      handleTransitionEnd();
    });

    // Block the thread to handle that event.
    touchMoveListener.current = addEventListener(
      rootNode,
      'touchmove',
      (event) => {
        // Handling touch events is disabled.
        if (disabled) {
          return;
        }
        handleSwipeMove(event);
      },
      {
        passive: false,
      },
    );

    if (!this.props.disableLazyLoading) {
      this.firstRenderTimeout = setTimeout(() => {
        this.setState({
          renderOnlyActive: false,
        });
      }, 0);
    }

    // Send all functions in an object if action param is set.
    if (this.props.action) {
      this.props.action({
        updateHeight: this.updateHeight,
      });
    }
  }, []);

  return (
    <SwipeableViews
      action={action}
      animateHeight={animateHeight}
      animateTransitions={animateTransitions}
      axis={axis}
      containerStyle={containerStyle}
      disabled={disabled}
      disableLazyLoading={renderOnlyActive}
      enableMouseEvents={enableMouseEvents}
      hysteresis={hysteresis}
      ignoreNativeScroll={ignoreNativeScroll}
      index={indexLatest}
      onChangeIndex={onChangeIndex}
      onMouseDown={onMouseDown}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onScroll={onScroll}
      onSwitching={onSwitching}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
      onTouchStart={onTouchStart}
      onTransitionEnd={onTransitionEnd}
      resistance={resistance}
      slideClassName={slideClassName}
      slideStyle={slideStyle}
      springConfig={springConfig}
      style={style}
      threshold={threshold}
    >
      {children}
    </SwipeableViews>
  );
};

export default SwipeableComponent;
