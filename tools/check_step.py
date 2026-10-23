# Import check of STEP files with FreeCAD / OpenCascade (run with FreeCADCmd):
#   set GEROTOR_STEP_FILES=a.step;b.step  then  FreeCADCmd.exe tools/check_step.py
# (file names via the environment: FreeCADCmd would try to open extra arguments itself)
# Prints one JSON line per file: validity, solids, volumes, closedness, bounding box, face types.
import os, json
import Part

files = [f for f in os.environ.get('GEROTOR_STEP_FILES', '').split(';') if f.strip()]
for path in files:
    out = {'file': path}
    try:
        shape = Part.read(path)
        out['valid'] = shape.isValid()
        out['shapeType'] = shape.ShapeType
        out['solids'] = [{
            'valid': s.isValid(),
            'closed': s.isClosed(),
            'volume': round(s.Volume, 4),
            'faces': len(s.Faces),
            'faceTypes': sorted(set(type(f.Surface).__name__ for f in s.Faces)),
        } for s in shape.Solids]
        bb = shape.BoundBox
        out['bbox'] = [round(v, 4) for v in (bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax)]
        out['check'] = 'ok'
        try:
            shape.check(True)
        except Exception as e:
            out['check'] = str(e)[:400]
    except Exception as e:
        out['error'] = str(e)[:400]
    print('RESULT ' + json.dumps(out))
