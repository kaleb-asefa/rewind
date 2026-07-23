from fastapi import FastAPI


app = FastAPI()


@app.get('/api/total-listened-time')
def total_listened_time():
    pass