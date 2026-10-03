# AgenticThat Companion 2.1.22

This release fixes YouTube Community image posts with long descriptions. When
the description pushes the Image control below the browser viewport, Companion
now scrolls the composer to the real button and clicks the element directly
before assigning the local image exactly once. It also drains the active job
heartbeat before reporting completion so a delayed heartbeat cannot make a
finished attempt appear stuck as publishing.

The change is isolated to YouTube Community image attachment. No other social
publishing flow is changed.
