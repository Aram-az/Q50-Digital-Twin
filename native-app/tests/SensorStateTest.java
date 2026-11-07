import com.aram.q50telemetry.SensorState;

/** Simple Java unit tests runnable without Android or Gradle. */
public class SensorStateTest {
    static void check(boolean ok, String explanation) {
        if (!ok) throw new AssertionError(explanation);
    }
    public static void main(String[] args) {
        SensorState state = new SensorState();
        check(!state.seen(13), "Should begin with no fake sensor readings");
        check(!state.fresh(13, 1000), "Unknown sensor cannot be fresh");
        check(state.accept(13, 742.2f, 1000), "Should accept RPM");
        check(state.fresh(13, 2500), "Should be fresh for 3 seconds");
        check(!state.fresh(13, 4001), "Old sensor must become stale");
        check(!state.accept(13, Float.NaN, 4002), "NaN rejected");
        check(!state.accept(13, Float.POSITIVE_INFINITY, 4002), "Infinity rejected");
        check(!state.accept(100, 5f, 4002), "Unsupported type rejected");
        check(state.count(13) == 1, "Only one accepted reading");
        check(state.accept(13, 810f, 4500), "Accept newer reading");
        check(state.peak(13) == 810f, "Peak tracked");
        check(state.totalEvents() == 2, "Total event count correct");
        state.setAvailableSensors(44, 38);
        check(state.subscribedSensors() == 38, "Subscription count correct");
        System.out.println("PASS: 12 SensorState checks");
    }
}
