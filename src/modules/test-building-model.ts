import type { BuildingGeometry, Evidence, Opening } from '../types/domain'

/**
 * 3D renderer smoke-test data only.
 *
 * This model is deliberately kept outside ProjectState. It is never passed to
 * the takeoff or optimization engines and is never persisted as project data.
 */
const testEvidence: Evidence = {
  fileId: '3d-renderer-test',
  fileName: '3D 화면 확인용 테스트 모델',
  pageNumber: 1,
  drawingKind: 'unknown',
  method: 'derived',
  note: '실제 설계도 분석 결과가 아니며 렌더링 확인에만 사용합니다.',
}

const testOpening = (opening: Omit<Opening, 'evidence'>): Opening => ({
  ...opening,
  evidence: [testEvidence],
})

export function createTestBuildingGeometry(): BuildingGeometry {
  return {
    walls: [
      {
        wallId: 'TEST-WALL-A-01',
        zone: '테스트 구역 A',
        zoneName: '테스트 구역 A',
        number: 'A-01',
        wallNumber: 'A-01',
        start: { x: -4, y: 0, z: -2 },
        end: { x: 4, y: 0, z: -2 },
        lengthMm: 8000,
        heightMm: 2800,
        thicknessMm: 150,
        openings: [testOpening({
          id: 'TEST-DOOR-01',
          type: 'door',
          label: '테스트 문',
          widthMm: 900,
          heightMm: 2100,
          sillHeightMm: 0,
          offsetMm: 1700,
          areaM2: 1.89,
          confidence: 'high',
          excludedFromAutomaticTakeoff: false,
        })],
        color: '#2f6fed',
        confidence: 'high',
        sourceReferences: [testEvidence],
        geometrySource: 'dimension-layout',
      },
      {
        wallId: 'TEST-WALL-B-01',
        zone: '테스트 구역 B',
        zoneName: '테스트 구역 B',
        number: 'B-01',
        wallNumber: 'B-01',
        start: { x: 4, y: 0, z: -2 },
        end: { x: 4, y: 0, z: 4 },
        lengthMm: 6000,
        heightMm: 4200,
        thicknessMm: 150,
        openings: [testOpening({
          id: 'TEST-WINDOW-01',
          type: 'window',
          label: '테스트 창문',
          widthMm: 1400,
          heightMm: 1500,
          sillHeightMm: 900,
          offsetMm: 2100,
          areaM2: 2.1,
          confidence: 'high',
          excludedFromAutomaticTakeoff: false,
        })],
        color: '#16836d',
        confidence: 'high',
        sourceReferences: [testEvidence],
        geometrySource: 'dimension-layout',
      },
    ],
    footprint: [
      { x: -4, z: -2 },
      { x: 4, z: -2 },
      { x: 4, z: 4 },
    ],
    roof: {
      isReady: false,
      kind: 'unknown',
      heightMm: null,
      pitchDeg: null,
      evidence: [testEvidence],
      blockedReason: '테스트 모델에는 지붕을 포함하지 않습니다.',
    },
    isReady: true,
    partial: false,
    blockedWallIds: [],
    blockedReason: '3D 렌더링 확인용 테스트 geometry입니다.',
  }
}
