/** Whole bylines with an explicit timestamp, only ahead of the first editorial line. */
export default [/^(?:by|written by)\s+[^.!?\n]{2,60}\s+[I|·–—-]\s+(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\s*[-–|·]\s*\d{1,2}:\d{2}(?:\s*[ap]m)?$/iu];
