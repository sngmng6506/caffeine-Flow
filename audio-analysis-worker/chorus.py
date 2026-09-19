"""곡에서 가장 많이 반복되는 구간을 찾는다(Goto 2003 RefraiD 계열).

시간-시간 유사도 대신 **시간-지연** 유사도를 쓴다. 지연축으로 놓으면 "지연 l만큼
뒤에 같은 것이 되풀이된다"가 대각선이 아니라 수평선으로 나타나고, 수평선은 검출이
훨씬 쉽다. 이것이 이 계열 방법의 핵심이다.

구현은 pychorus(https://github.com/vivjay30/pychorus)를 옮긴 것이다. 그쪽은
librosa·scipy를 쓰는데 둘 다 이 워커에 없고, 4코어 미니PC에 numba를 올릴 이유도
없어 numpy만으로 다시 썼다. 세 곡(재즈·K-pop·trap)에서 같은 구간을 고르는 것을
확인하고 들여왔다 — 검증 기록은 experiments/를 본다.

크로마는 음높이 분포만 남기고 음색을 버린다. 그래서 편곡이 달라도 같은 후렴으로
인식하는 것이 강점이지만, **악기가 바뀌는 것은 보지 못한다.** 매장 정책이 악기를
가리키므로 이 구간만으로 판단하지 않는다.
"""

import numpy as np

# 2.5초. 수평선을 강조할 때 쓰는 이동평균 폭이다.
SMOOTHING_SIZE_SEC = 2.5
# 크로마 한 프레임의 크기. 길게 잡을수록 화성이 안정적으로 잡히고 프레임 수가 준다.
FRAME_SIZE = 16384
HOP_SIZE = FRAME_SIZE // 4
# 선분으로 인정할 임계값. 충분한 수가 안 나오면 낮춰 가며 다시 찾는다.
LINE_THRESHOLD = 0.15
MIN_LINES = 8
NUM_ITERATIONS = 8
# 겹침을 셀 때 허용하는 오차. 구간 길이에 비례시킨다.
OVERLAP_PERCENT_MARGIN = 0.2

A4_HZ = 440.0


class Line:
    """시간-지연 행렬에서 찾은 수평선 하나. 반복 쌍 하나를 뜻한다."""

    __slots__ = ('start', 'end', 'lag')

    def __init__(self, start, end, lag):
        self.start, self.end, self.lag = start, end, lag


def chroma_of(audio, sample_rate):
    """12차원 크로마. 프레임마다 최댓값 1로 맞춘다.

    FFT 빈을 음이름으로 접어 파워를 더한다. 프레임 정규화를 하는 것은 유사도가
    음량이 아니라 화성으로 결정되게 하려는 것이다.
    """
    window = np.hanning(FRAME_SIZE)
    bins = np.fft.rfftfreq(FRAME_SIZE, d=1.0 / sample_rate)
    # 20Hz 아래와 나이퀴스트 근처는 음이름으로 접을 수 없다.
    usable = (bins >= 20.0) & (bins <= sample_rate / 2.0 - 1.0)
    pitch = np.zeros(len(bins), dtype=int)
    pitch[usable] = np.round(12 * np.log2(bins[usable] / A4_HZ)).astype(int) % 12

    frames = []
    for start in range(0, max(1, len(audio) - FRAME_SIZE + 1), HOP_SIZE):
        spectrum = np.abs(np.fft.rfft(audio[start:start + FRAME_SIZE] * window)) ** 2
        folded = np.bincount(pitch[usable], weights=spectrum[usable], minlength=12)
        peak = folded.max()
        frames.append(folded / peak if peak > 0 else folded)
    return np.array(frames).T if frames else np.zeros((12, 0))


def _box_full(matrix, size, axis):
    """폭 size의 이동평균. scipy.signal.convolve2d(mode='full')과 같은 길이를 낸다."""
    kernel = np.ones(size) / size
    return np.apply_along_axis(lambda row: np.convolve(row, kernel, mode='full'), axis, matrix)


def _gaussian_rows(matrix, sigma):
    """행 방향 가우시안 평활. scipy.ndimage.gaussian_filter1d(axis=1)과 같다."""
    radius = int(4.0 * sigma + 0.5)
    offsets = np.arange(-radius, radius + 1)
    kernel = np.exp(-0.5 * (offsets / sigma) ** 2)
    kernel /= kernel.sum()
    padded = np.pad(matrix, ((0, 0), (radius, radius)), mode='reflect')
    return np.apply_along_axis(lambda row: np.convolve(row, kernel, mode='valid'), 1, padded)


def _local_maxima_rows(matrix):
    """행 합이 국소 최대인 지연들. 반복이 몰려 있는 지연만 남긴다."""
    sums = matrix.sum(axis=1) / np.arange(matrix.shape[0], 0, -1)
    return np.flatnonzero((sums[1:-1] > sums[:-2]) & (sums[1:-1] > sums[2:])) + 1


def _time_time(chroma):
    difference = chroma[:, :, None] - chroma[:, None, :]
    return 1.0 - np.linalg.norm(difference, axis=0) / np.sqrt(12)


def _time_lag(time_time):
    """L[lag, t] = T[t, t-lag]. 대각선을 행으로 옮겨 담는다."""
    total = time_time.shape[0]
    lag = np.zeros_like(time_time)
    for offset in range(total):
        lag[offset, offset:] = np.diag(time_time, -offset)
    return lag


def _denoise(time_lag, time_time, smoothing):
    """수평선만 남긴다. 수직·대각 성분을 빼서 억제한다."""
    total = time_lag.shape[0]
    horizontal = _box_full(time_lag, smoothing, axis=1)
    max_horizontal = np.maximum(horizontal[:, :total], horizontal[:, smoothing - 1:])

    vertical = _box_full(time_lag, smoothing, axis=0)
    down, up = vertical[:total, :], vertical[smoothing - 1:, :]

    # 시간-지연의 대각 평균은 시간-시간의 수평 평균과 같다. 그쪽에서 가져온다.
    diagonal = _box_full(time_time, smoothing, axis=1)
    lower, upper = np.zeros((total, total)), np.zeros((total, total))
    rows, cols = np.triu_indices(total, 1)
    lower[rows, cols] = diagonal[cols - rows, cols]
    upper[rows, cols] = diagonal[cols - rows, cols + smoothing - 1]

    others = [down, up, lower, upper]
    non_horizontal_max = np.maximum.reduce(others)
    non_horizontal_min = np.minimum.reduce(others)
    # 수평이 더 세면 최솟값만 빼고, 아니면 최댓값을 뺀다.
    suppression = np.where(max_horizontal > non_horizontal_max,
                           non_horizontal_min, non_horizontal_max)

    denoised = _gaussian_rows(np.triu(time_lag - suppression), smoothing)
    denoised = np.maximum(denoised, 0)
    denoised[0:5, :] = 0
    return denoised


def _detect_lines(denoised, rows, min_length):
    """임계값을 낮춰 가며 선분이 충분히 나올 때까지 찾는다."""
    threshold = LINE_THRESHOLD
    for _ in range(NUM_ITERATIONS):
        found = []
        for row in rows:
            if row < min_length:
                continue
            start = None
            for col in range(row, denoised.shape[0]):
                if denoised[row, col] > threshold:
                    if start is None:
                        start = col
                else:
                    if start is not None and (col - start) > min_length:
                        found.append(Line(start, col, row))
                    start = None
        if len(found) >= MIN_LINES:
            return found
        threshold *= 0.95
    return found


def _score_lines(lines, margin, min_length):
    """다른 선분을 덮는 선분에 점수를 준다. 많이 되풀이될수록 점수가 높다."""
    scores = []
    for line in lines:
        score = 0
        for other in lines:
            if abs(other.lag - line.lag) <= min_length:
                continue
            covers = other.start < line.start + margin and other.end > line.end - margin
            shifted = ((other.start - other.lag) < (line.start - line.lag + margin)
                       and (other.end - other.lag) > (line.end - line.lag - margin))
            if covers or shifted:
                score += 1
        scores.append((score, line.end - line.start, line))
    return scores


def detect_chorus(audio, sample_rate, min_length_sec):
    """가장 많이 반복되는 구간을 (시작초, 끝초)로 돌려준다. 못 찾으면 None.

    min_length_sec는 자르는 길이가 아니라 **후렴으로 인정할 최소 반복 길이**다.
    이 값이 커지면 후보 선분 집합 자체가 달라져 다른 구간이 뽑힐 수 있다.
    """
    duration = len(audio) / float(sample_rate)
    if duration <= min_length_sec:
        return None
    chroma = chroma_of(np.asarray(audio, dtype=np.float64), sample_rate)
    total = chroma.shape[1]
    if total < 16:
        return None

    frames_per_sec = total / duration
    smoothing = max(2, int(SMOOTHING_SIZE_SEC * frames_per_sec))
    min_length = min_length_sec * frames_per_sec

    time_time = _time_time(chroma)
    denoised = _denoise(_time_lag(time_time), time_time, smoothing)
    lines = _detect_lines(denoised, _local_maxima_rows(denoised), min_length)
    if not lines:
        return None

    scores = _score_lines(lines, OVERLAP_PERCENT_MARGIN * min_length, min_length)
    # 되풀이 횟수를 먼저 보고, 같으면 긴 쪽을 고른다.
    _score, _length, best = max(scores, key=lambda item: (item[0], item[1]))
    return best.start / frames_per_sec, best.end / frames_per_sec
