import React from 'react';

const checkIndexBounds = ({ index, children }) => {
  const childrenCount = React.Children.count(children);

  console.warn(
    index >= 0 && index <= childrenCount,
    `react-swipeable-view: the new index: ${index} is out of bounds: [0-${childrenCount}].`,
  );
};

export default checkIndexBounds;
